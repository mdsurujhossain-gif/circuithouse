# Circuit House Register — Python (Flask) portal

মূল React/JSX প্রোটোটাইপ (`circuit-house-register.jsx`)-এর হুবহু ডিজাইন ও ফিচার নিয়ে বানানো একটি
পূর্ণাঙ্গ Python (Flask + SQLite) ওয়েব পোর্টাল। ২ তলা, ১৪টি রুম (VIP/Normal), মাস-ভিত্তিক Gantt
ভিউ, রুম-কী ট্যাগ, বুকিং তৈরি/এডিট/ডিলিট, ওভারল্যাপ চেক এবং সার্চ — সবই আছে, শুধু ডেটা এখন
ব্রাউজারের বদলে সার্ভারের SQLite ডাটাবেজে থাকে, তাই সবাই একসাথে একই তথ্য দেখে।

## চালানোর নিয়ম

```bash
cd circuit-house-portal
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

এরপর ব্রাউজারে যান: **http://localhost:5000**

প্রথমবার চালালে `circuit_house.db` নামে একটি SQLite ফাইল নিজে থেকে তৈরি হয়ে যাবে —
কোনো আলাদা সেটআপ লাগবে না।

## গঠন

```
circuit-house-portal/
├── app.py                # Flask app + SQLite মডেল + REST API + auth
├── requirements.txt
├── templates/
│   ├── index.html         # প্রধান পেজ (লগইন করা থাকলেই দেখা যাবে)
│   ├── login.html         # লগইন পেজ
│   └── admin_users.html   # সুপার-অ্যাডমিনের ইউজার ম্যানেজমেন্ট পেজ
└── static/
    ├── style.css          # মূল JSX ডিজাইনের হুবহু CSS
    └── app.js             # ফ্রন্টএন্ড লজিক (React state → vanilla JS + fetch)
```

## লগইন ও ইউজার ম্যানেজমেন্ট (নতুন)

এখন পোর্টালে **লগইন বাধ্যতামূলক** — শুধু অনুমোদিত (অ্যাডমিনের তৈরি করা) ইউজাররাই ঢুকতে ও ডেটা
ইনপুট দিতে পারবে। কোনো সাইন-আপ ফর্ম নেই।

প্রথমবার `python app.py` চালালে টার্মিনালে এরকম একটা মেসেজ দেখবেন:

```
==============================================================
 First run: a super-admin account has been created.
   Username: admin
   Password: xxxxxxxxxxxx
 Please log in and create named accounts for real users,
 then keep this password somewhere safe (it will not be
 shown again — reset it from the Manage users page).
==============================================================
```

এই `admin` ইউজার দিয়ে লগইন করে **"Manage users"** পেজ থেকে:
- নতুন ইউজার তৈরি করতে পারবেন (ইউজারনেম + পাসওয়ার্ড, চাইলে অ্যাডমিন অ্যাক্সেসও দিতে পারবেন)
- যেকোনো ইউজারের পাসওয়ার্ড রিসেট করতে পারবেন
- ইউজার ডিজেবল/এনাবল বা ডিলিট করতে পারবেন (নিজের অ্যাকাউন্ট বাদে)

> `.secret_key` নামে একটা ফাইল অটো-জেনারেট হবে — এটা সেশন সাইনিংয়ের জন্য ব্যবহৃত হয়, মুছে
> ফেললে সব লগইন সেশন invalid হয়ে যাবে। এই ফাইল ও `circuit_house.db` কখনো পাবলিক রিপোজিটরিতে
> কমিট করবেন না।



## API

| Method | Route                  | কাজ                          |
|--------|-------------------------|-------------------------------|
| GET    | `/api/rooms`             | রুম ও ফ্লোরের তালিকা দেয়      |
| GET    | `/api/bookings`          | সব বুকিং ফেরত দেয়             |
| POST   | `/api/bookings`          | নতুন বুকিং তৈরি করে           |
| PUT    | `/api/bookings/<id>`     | বুকিং আপডেট করে               |
| DELETE | `/api/bookings/<id>`     | বুকিং ডিলিট করে               |

সবগুলো `/api/*` রুট এখন লগইন-সুরক্ষিত — সেশন কুকি ছাড়া কল করলে `401` রেসপন্স আসবে।
সার্ভার নিজেই তারিখ-ওভারল্যাপ যাচাই করে, তাই একই রুম একসাথে দুইজনকে দেওয়া যাবে না।

## রুম কনফিগারেশন বদলাতে চাইলে

`app.py`-এর উপরের দিকে `ROOM_DEFS` লিস্টটা এডিট করুন — তলা, রুম নম্বর ও টাইপ (VIP/Normal)
এখান থেকেই নিয়ন্ত্রিত হয়।
# circuithouse
