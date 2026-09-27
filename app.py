"""
Circuit House Register — Flask portal
A room-booking register for a 2-floor / 14-room circuit house,
ported from a React/JSX single-file prototype to a Python (Flask + SQLite) app.
Now with login-protected access and a super-admin user management panel.
"""
import os
import secrets
import sqlite3
import uuid
from datetime import date, datetime

from flask import Flask, abort, flash, g, jsonify, redirect, render_template, request, url_for
from flask_cors import CORS
from flask_login import (
    LoginManager, UserMixin, current_user, login_required,
    login_user, logout_user,
)
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "circuit_house.db")
SECRET_KEY_PATH = os.path.join(BASE_DIR, ".secret_key")


def get_or_create_secret_key():
    if os.path.exists(SECRET_KEY_PATH):
        with open(SECRET_KEY_PATH, "r") as f:
            key = f.read().strip()
            if key:
                return key
    key = secrets.token_hex(32)
    with open(SECRET_KEY_PATH, "w") as f:
        f.write(key)
    return key


app = Flask(__name__)
app.config["SECRET_KEY"] = get_or_create_secret_key()
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

login_manager = LoginManager(app)
login_manager.login_view = "login"
login_manager.login_message = "Please log in to continue."
login_manager.login_message_category = "error"


@login_manager.unauthorized_handler
def unauthorized():
    if request.path.startswith("/api/"):
        return jsonify({"error": "Login required."}), 401
    return redirect(url_for("login", next=request.path))

# ---------- room configuration (mirrors ROOM_DEFS in the original JSX) ----------

ROOM_DEFS = [
    {"floor": 1, "numbers": [201, 202], "type": "VIP"},
    {"floor": 1, "numbers": [203, 204, 205, 206, 207, 208], "type": "Normal"},
    {"floor": 2, "numbers": [301, 302], "type": "VIP"},
    {"floor": 2, "numbers": [303, 304, 305, 306, 307, 308], "type": "Normal"},
]

ROOMS = []
for defn in ROOM_DEFS:
    for num in defn["numbers"]:
        ROOMS.append({"id": str(num), "number": num, "floor": defn["floor"], "type": defn["type"]})

FLOORS_LIST = sorted({r["floor"] for r in ROOMS})

ROOMS_BY_ID = {r["id"]: r for r in ROOMS}


# ---------- database helpers ----------

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS bookings (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            guest_name TEXT NOT NULL,
            designation TEXT DEFAULT '',
            contact TEXT DEFAULT '',
            comment TEXT DEFAULT '',
            check_in TEXT NOT NULL,
            check_out TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()

    # Migration: add the `comment` column for databases created before it existed.
    existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(bookings)").fetchall()}
    if "comment" not in existing_cols:
        conn.execute("ALTER TABLE bookings ADD COLUMN comment TEXT DEFAULT ''")
        conn.commit()

    # Migration: bookings created before time-of-day support was added only
    # have a plain date (10 chars). Give them sensible default times so they
    # compare correctly against "now" (typical hotel check-in/out times).
    conn.execute("UPDATE bookings SET check_in = check_in || 'T14:00' WHERE length(check_in) = 10")
    conn.execute("UPDATE bookings SET check_out = check_out || 'T12:00' WHERE length(check_out) = 10")
    conn.commit()

    # Seed a default super admin the very first time the app runs.
    existing = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if existing == 0:
        admin_id = str(uuid.uuid4())
        generated_password = secrets.token_urlsafe(9)
        conn.execute(
            "INSERT INTO users (id, username, password_hash, is_admin, is_active, created_at) "
            "VALUES (?, ?, ?, 1, 1, ?)",
            (admin_id, "admin", generate_password_hash(generated_password), date.today().isoformat()),
        )
        conn.commit()
        print("=" * 62)
        print(" First run: a super-admin account has been created.")
        print(f"   Username: admin")
        print(f"   Password: {generated_password}")
        print(" Please log in and create named accounts for real users,")
        print(" then keep this password somewhere safe (it will not be")
        print(" shown again — reset it from the Manage users page).")
        print("=" * 62)

    conn.close()


class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.username = row["username"]
        self.is_admin = bool(row["is_admin"])
        self.is_active_flag = bool(row["is_active"])

    def get_id(self):
        return self.id

    @property
    def is_active(self):
        return self.is_active_flag


@login_manager.user_loader
def load_user(user_id):
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return User(row) if row else None


def admin_required(view):
    from functools import wraps

    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if not current_user.is_admin:
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def row_to_dict(row):
    return {
        "id": row["id"],
        "roomId": row["room_id"],
        "guestName": row["guest_name"],
        "designation": row["designation"],
        "contact": row["contact"],
        "comment": row["comment"],
        "checkIn": row["check_in"],
        "checkOut": row["check_out"],
        "createdAt": row["created_at"],
    }


def overlap_exists(db, room_id, check_in, check_out, exclude_id=None):
    query = (
        "SELECT COUNT(*) FROM bookings "
        "WHERE room_id = ? AND check_in <= ? AND check_out >= ?"
    )
    params = [room_id, check_out, check_in]
    if exclude_id:
        query += " AND id != ?"
        params.append(exclude_id)
    return db.execute(query, params).fetchone()[0] > 0


# ---------- auth ----------

@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("index"))

    error = None
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        db = get_db()
        row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        if row and check_password_hash(row["password_hash"], password):
            if not row["is_active"]:
                error = "This account has been disabled. Contact your administrator."
            else:
                login_user(User(row))
                next_url = request.args.get("next") or url_for("index")
                return redirect(next_url)
        else:
            error = "Invalid username or password."

    return render_template("login.html", error=error)


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("login"))


# ---------- admin: user management ----------

@app.route("/admin/users", methods=["GET"])
@admin_required
def admin_users():
    db = get_db()
    users = db.execute("SELECT * FROM users ORDER BY created_at, username").fetchall()
    return render_template("admin_users.html", users=users)


@app.route("/admin/users", methods=["POST"])
@admin_required
def admin_create_user():
    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
    is_admin = 1 if request.form.get("is_admin") == "on" else 0

    db = get_db()
    if not username or not password:
        flash("Username and password are required.", "error")
    elif len(password) < 6:
        flash("Password must be at least 6 characters.", "error")
    elif db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        flash(f'Username "{username}" is already taken.', "error")
    else:
        db.execute(
            "INSERT INTO users (id, username, password_hash, is_admin, is_active, created_at) "
            "VALUES (?, ?, ?, ?, 1, ?)",
            (str(uuid.uuid4()), username, generate_password_hash(password), is_admin, date.today().isoformat()),
        )
        db.commit()
        flash(f'User "{username}" created.', "success")
    return redirect(url_for("admin_users"))


@app.route("/admin/users/<user_id>/password", methods=["POST"])
@admin_required
def admin_reset_password(user_id):
    password = request.form.get("password") or ""
    db = get_db()
    target = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not target:
        flash("User not found.", "error")
    elif len(password) < 6:
        flash("Password must be at least 6 characters.", "error")
    else:
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (generate_password_hash(password), user_id))
        db.commit()
        flash(f'Password updated for "{target["username"]}".', "success")
    return redirect(url_for("admin_users"))


@app.route("/admin/users/<user_id>/toggle-active", methods=["POST"])
@admin_required
def admin_toggle_active(user_id):
    db = get_db()
    target = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not target:
        flash("User not found.", "error")
    elif target["id"] == current_user.id:
        flash("You can't disable your own account.", "error")
    else:
        new_state = 0 if target["is_active"] else 1
        db.execute("UPDATE users SET is_active = ? WHERE id = ?", (new_state, user_id))
        db.commit()
        flash(f'"{target["username"]}" {"enabled" if new_state else "disabled"}.', "success")
    return redirect(url_for("admin_users"))


@app.route("/admin/users/<user_id>/delete", methods=["POST"])
@admin_required
def admin_delete_user(user_id):
    db = get_db()
    target = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not target:
        flash("User not found.", "error")
    elif target["id"] == current_user.id:
        flash("You can't delete your own account.", "error")
    else:
        db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        db.commit()
        flash(f'User "{target["username"]}" deleted.', "success")
    return redirect(url_for("admin_users"))


# ---------- page ----------

@app.route("/")
@login_required
def index():
    now = datetime.now()
    return render_template(
        "index.html",
        rooms=ROOMS,
        floors=FLOORS_LIST,
        today_str=now.date().isoformat(),
        now_str=now.strftime("%Y-%m-%dT%H:%M"),
        today_long=now.strftime("%-d %b %Y") if os.name != "nt" else now.strftime("%d %b %Y"),
        room_count=len(ROOMS),
        floor_count=len(FLOORS_LIST),
    )


# ---------- API ----------

@app.route("/api/rooms", methods=["GET"])
@login_required
def list_rooms():
    now = datetime.now()
    return jsonify({
        "rooms": ROOMS,
        "floors": FLOORS_LIST,
        "todayStr": now.date().isoformat(),
        "nowStr": now.strftime("%Y-%m-%dT%H:%M"),
    })


@app.route("/api/bookings", methods=["GET"])
@login_required
def list_bookings():
    db = get_db()
    rows = db.execute("SELECT * FROM bookings ORDER BY check_in").fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/bookings", methods=["POST"])
@login_required
def create_booking():
    data = request.get_json(force=True) or {}
    error = validate_booking(data)
    if error:
        return jsonify({"error": error}), 400

    db = get_db()
    if overlap_exists(db, data["roomId"], data["checkIn"], data["checkOut"]):
        return jsonify({"error": "This room is already booked for part of that date range."}), 409

    booking_id = str(uuid.uuid4())
    db.execute(
        "INSERT INTO bookings (id, room_id, guest_name, designation, contact, comment, check_in, check_out, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            booking_id,
            data["roomId"],
            data["guestName"].strip(),
            data.get("designation", "").strip(),
            data.get("contact", "").strip(),
            data.get("comment", "").strip(),
            data["checkIn"],
            data["checkOut"],
            date.today().isoformat(),
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()
    return jsonify(row_to_dict(row)), 201


@app.route("/api/bookings/<booking_id>", methods=["PUT"])
@login_required
def update_booking(booking_id):
    data = request.get_json(force=True) or {}
    error = validate_booking(data)
    if error:
        return jsonify({"error": error}), 400

    db = get_db()
    existing = db.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Booking not found."}), 404

    if overlap_exists(db, data["roomId"], data["checkIn"], data["checkOut"], exclude_id=booking_id):
        return jsonify({"error": "This room is already booked for part of that date range."}), 409

    db.execute(
        "UPDATE bookings SET room_id=?, guest_name=?, designation=?, contact=?, comment=?, check_in=?, check_out=? "
        "WHERE id=?",
        (
            data["roomId"],
            data["guestName"].strip(),
            data.get("designation", "").strip(),
            data.get("contact", "").strip(),
            data.get("comment", "").strip(),
            data["checkIn"],
            data["checkOut"],
            booking_id,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()
    return jsonify(row_to_dict(row))


@app.route("/api/bookings/<booking_id>", methods=["DELETE"])
@login_required
def delete_booking(booking_id):
    db = get_db()
    db.execute("DELETE FROM bookings WHERE id = ?", (booking_id,))
    db.commit()
    return jsonify({"ok": True})


def validate_booking(data):
    if not data.get("roomId") or data["roomId"] not in ROOMS_BY_ID:
        return "A valid room must be selected."
    if not data.get("guestName") or not data["guestName"].strip():
        return "Guest name is required."
    check_in = data.get("checkIn")
    check_out = data.get("checkOut")
    if not check_in or not check_out:
        return "Check-in and check-out date & time are required."
    if not is_valid_datetime_str(check_in) or not is_valid_datetime_str(check_out):
        return "Dates must include both date and time (YYYY-MM-DDTHH:MM)."
    if check_out < check_in:
        return "Check-out must be on or after check-in."
    return None


def is_valid_datetime_str(value):
    """Accepts 'YYYY-MM-DDTHH:MM' (preferred) and, for backward compatibility
    with bookings created before time support was added, plain 'YYYY-MM-DD'."""
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            datetime.strptime(value, fmt)
            return True
        except ValueError:
            continue
    return False


if __name__ == "__main__":
    init_db()
    app.run(debug=True, host="0.0.0.0", port=5000)
else:
    init_db()
