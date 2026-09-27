/* Circuit House Register — client logic
   Ported from the original React/JSX prototype to vanilla JS,
   talking to the Flask API instead of browser storage. */

(function () {
  "use strict";

  const DAY_W = 40;

  const ROOMS = window.__ROOMS__;
  const ROOMS_BY_ID = {};
  ROOMS.forEach((r) => { ROOMS_BY_ID[r.id] = r; });
  const FLOORS_LIST = window.__FLOORS__;
  const TODAY_STR = window.__TODAY_STR__;
  const NOW_STR = window.__NOW_STR__ || `${TODAY_STR}T00:00`;
  const TODAY = new Date(TODAY_STR + "T00:00:00");

  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));
  const WEEKDAY_LETTERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  function pad2(n) { return String(n).padStart(2, "0"); }
  function dayOf(dateStr) { return parseInt(dateStr.slice(8, 10), 10); }
  function maxStr(a, b) { return a > b ? a : b; }
  function minStr(a, b) { return a < b ? a : b; }
  function daysBetweenDates(aDateStr, bDateStr) {
    // Whole calendar days between two "YYYY-MM-DD" strings (b - a).
    const [ay, am, ad] = aDateStr.split("-").map(Number);
    const [by, bm, bd] = bDateStr.split("-").map(Number);
    const da = new Date(ay, am - 1, ad);
    const db = new Date(by, bm - 1, bd);
    return Math.round((db - da) / 86400000);
  }
  function dtOffsetFromDate(dtStr, baseDateStr) {
    // Fractional number of days from 00:00 of baseDateStr to dtStr, so that
    // each calendar day maps to a full 0–24 hour scale (e.g. 14:00 on a day
    // is offset 0.583 into that day's column, not the whole day).
    const datePart = dtStr.slice(0, 10);
    const diffDays = daysBetweenDates(baseDateStr, datePart);
    let hour = 0;
    let min = 0;
    if (dtStr.length > 10) {
      const parts = dtStr.slice(11, 16).split(":").map(Number);
      hour = parts[0] || 0;
      min = parts[1] || 0;
    }
    return diffDays + (hour + min / 60) / 24;
  }
  function shortDate(dateStr) { const [y, m, d] = dateStr.split("-").map(Number); return `${MONTH_SHORT[m - 1]} ${d}`; }
  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }
  function formatDateTime(dtStr) {
    // Accepts "YYYY-MM-DDTHH:MM" (preferred) or legacy date-only "YYYY-MM-DD".
    const datePart = dtStr.slice(0, 10);
    const [y, m, d] = datePart.split("-").map(Number);
    const dateLabel = `${d} ${MONTH_SHORT[m - 1]}`;
    if (dtStr.length < 16) return dateLabel;
    let [hh, mm] = dtStr.slice(11, 16).split(":").map(Number);
    const ampm = hh >= 12 ? "PM" : "AM";
    let hour12 = hh % 12;
    if (hour12 === 0) hour12 = 12;
    return `${dateLabel}, ${hour12}:${pad2(mm)} ${ampm}`;
  }
  function formatTimeOnly(dtStr) {
    if (dtStr.length < 16) return "";
    let [hh, mm] = dtStr.slice(11, 16).split(":").map(Number);
    const ampm = hh >= 12 ? "PM" : "AM";
    let hour12 = hh % 12;
    if (hour12 === 0) hour12 = 12;
    return `${hour12}:${pad2(mm)} ${ampm}`;
  }
  function formatFullDate(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d);
    const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return `${WEEKDAY_NAMES[dateObj.getDay()]}, ${d} ${MONTH_SHORT[m - 1]} ${y}`;
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const state = {
    bookings: [],
    loading: true,
    viewYear: TODAY.getFullYear(),
    viewMonthIdx: TODAY.getMonth(),
    search: "",
    modalState: null, // { mode: 'new'|'edit', booking }
    popoverState: null, // { bookingId, rect }
  };

  const el = {
    keyboard: document.getElementById("keyboard"),
    ganttGrid: document.getElementById("gantt-grid"),
    monthLabel: document.getElementById("month-label"),
    searchInput: document.getElementById("search-input"),
    noticeArea: document.getElementById("notice-area"),
    modalRoot: document.getElementById("modal-root"),
  };

  // The event popover (Google-Calendar-style click card) needs its own root
  // so it can sit above the page without disturbing the gantt's own layout.
  el.popoverRoot = document.createElement("div");
  el.popoverRoot.id = "popover-root";
  document.body.appendChild(el.popoverRoot);

  /* ---------------- data loading ---------------- */

  async function fetchBookings() {
    state.loading = true;
    try {
      const res = await fetch("/api/bookings");
      if (res.status === 401) { window.location.href = "/login"; return; }
      state.bookings = await res.json();
    } catch (e) {
      showNotice("Could not load bookings from the server. Please refresh.");
    } finally {
      state.loading = false;
      renderAll();
    }
  }

  function showNotice(message, timeout = 6000) {
    el.noticeArea.innerHTML = `<div class="chm-notice">${escapeHtml(message)}</div>`;
    if (timeout) setTimeout(() => { el.noticeArea.innerHTML = ""; }, timeout);
  }

  /* ---------------- derived helpers ---------------- */

  function daysInMonth() {
    return new Date(state.viewYear, state.viewMonthIdx + 1, 0).getDate();
  }

  function buildDays() {
    const n = daysInMonth();
    const days = [];
    for (let i = 0; i < n; i++) {
      const day = i + 1;
      const dateObj = new Date(state.viewYear, state.viewMonthIdx, day);
      const wd = dateObj.getDay();
      const dateStr = `${state.viewYear}-${pad2(state.viewMonthIdx + 1)}-${pad2(day)}`;
      days.push({
        day,
        weekdayLetter: WEEKDAY_LETTERS[wd],
        isWeekend: wd === 5 || wd === 6,
        isToday: dateStr === TODAY_STR,
        dateStr,
      });
    }
    return days;
  }

  function rowBackground(days) {
    const layers = [];
    days.forEach((d) => {
      const left = (d.day - 1) * DAY_W;
      if (d.isWeekend || d.isToday) {
        const color = d.isToday ? "rgba(201,138,44,0.18)" : "rgba(28,43,51,0.045)";
        layers.push(`linear-gradient(${color},${color}) ${left}px 0 / ${DAY_W}px 100% no-repeat`);
      }
      // Day boundary (00:00) and midday (12:00) guide lines, so each column
      // reads visually as a 0–24 hour scale that a booking bar sits within.
      layers.push(`linear-gradient(rgba(18,24,28,0.09),rgba(18,24,28,0.09)) ${left}px 0 / 1px 100% no-repeat`);
      layers.push(`linear-gradient(rgba(18,24,28,0.05),rgba(18,24,28,0.05)) ${left + DAY_W / 2}px 0 / 1px 100% no-repeat`);
    });
    return layers.length ? layers.join(", ") : "none";
  }

  function roomMatches(room, query) {
    if (!query) return true;
    if (String(room.number).includes(query)) return true;
    if (room.type.toLowerCase().includes(query)) return true;
    return state.bookings.some(
      (b) =>
        b.roomId === room.id &&
        (b.guestName.toLowerCase().includes(query) ||
          (b.designation || "").toLowerCase().includes(query) ||
          (b.contact || "").toLowerCase().includes(query) ||
          (b.comment || "").toLowerCase().includes(query))
    );
  }

  /* ---------------- rendering: keytags ---------------- */

  function renderKeyboard() {
    const frags = FLOORS_LIST.map((floor) => {
      const rooms = ROOMS.filter((r) => r.floor === floor);
      const tags = rooms
        .map((room) => {
          const current = state.bookings.find((b) => b.roomId === room.id && b.checkIn <= NOW_STR && b.checkOut >= NOW_STR);
          const upcoming = state.bookings
            .filter((b) => b.roomId === room.id && b.checkIn > NOW_STR)
            .sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
          const tooltip = current
            ? `${current.guestName}${current.designation ? " — " + current.designation : ""} — checks out ${formatDateTime(current.checkOut)}`
            : upcoming
              ? `Next: ${upcoming.guestName} from ${formatDateTime(upcoming.checkIn)}`
              : "No bookings scheduled";

          const starSvg = room.type === "VIP"
            ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor"><polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9"/></svg>`
            : "";

          let bodyHtml;
          if (current) {
            bodyHtml = `<div class="keytag-guest">${escapeHtml(current.guestName)}</div>`;
          } else if (upcoming) {
            bodyHtml = `<div class="keytag-guest">${escapeHtml(upcoming.guestName)}</div><div class="keytag-next">From ${escapeHtml(formatDateTime(upcoming.checkIn))}</div>`;
          } else {
            bodyHtml = `<div class="keytag-next">Available</div>`;
          }

          const stateClass = current ? "occupied" : upcoming ? "upcoming" : "";

          return `<div class="keytag ${room.type === "VIP" ? "vip" : ""} ${stateClass}"
              data-room-id="${room.id}" data-current-id="${current ? current.id : ""}" data-upcoming-id="${upcoming ? upcoming.id : ""}" title="${escapeHtml(tooltip)}">
              <div class="keytag-num">${room.number}${starSvg}</div>
              ${bodyHtml}
            </div>`;
        })
        .join("");

      return `<div>
          <div class="chm-floor-label">Floor ${floor} — today</div>
          <div class="chm-tags-row">${tags}</div>
        </div>`;
    });

    el.keyboard.innerHTML = frags.join("");

    el.keyboard.querySelectorAll(".keytag").forEach((node) => {
      node.addEventListener("click", () => {
        const roomId = node.getAttribute("data-room-id");
        const currentId = node.getAttribute("data-current-id");
        const upcomingId = node.getAttribute("data-upcoming-id");
        if (currentId) {
          const booking = state.bookings.find((b) => b.id === currentId);
          openEdit(booking);
        } else if (upcomingId) {
          const booking = state.bookings.find((b) => b.id === upcomingId);
          openEdit(booking);
        } else {
          openNew({ roomId });
        }
      });
    });
  }

  /* ---------------- rendering: gantt ---------------- */

  function renderGantt() {
    if (state.popoverState) closePopover();
    const days = buildDays();
    const monthStartStr = days[0].dateStr;
    const monthEndStr = days[days.length - 1].dateStr;
    const query = state.search.trim().toLowerCase();
    const anyMatch = ROOMS.some((r) => roomMatches(r, query));

    el.monthLabel.textContent = `${MONTH_NAMES[state.viewMonthIdx]} ${state.viewYear}`;

    el.ganttGrid.style.gridTemplateColumns = `150px repeat(${days.length}, ${DAY_W}px)`;

    let html = `<div class="chm-corner">Room</div>`;
    html += days
      .map(
        (d) => `<div class="chm-day-head ${d.isWeekend ? "weekend" : ""} ${d.isToday ? "today" : ""}">
          <div>${d.day}</div>
          <div class="chm-wd">${d.weekdayLetter}</div>
        </div>`
      )
      .join("");

    if (!anyMatch) {
      html += `<div class="chm-empty-row">No rooms match &ldquo;${escapeHtml(state.search)}&rdquo;.</div>`;
    } else {
      FLOORS_LIST.forEach((floor) => {
        const roomsInFloor = ROOMS.filter((r) => r.floor === floor && roomMatches(r, query));
        if (!roomsInFloor.length) return;

        html += `<div class="chm-floor-row" style="grid-column:1 / -1">Floor ${floor}</div>`;

        roomsInFloor.forEach((room) => {
          const roomBookings = state.bookings.filter(
            (b) => b.roomId === room.id && b.checkOut >= monthStartStr && b.checkIn <= monthEndStr
          );
          const starSvg = room.type === "VIP"
            ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor"><polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9"/></svg>`
            : "";

          html += `<div class="chm-room-label ${room.type === "VIP" ? "vip" : ""}">${starSvg} Room ${room.number}</div>`;
          html += `<div class="chm-row-track" data-room-id="${room.id}"
              style="grid-column: span ${days.length}; background:${rowBackground(days)}">`;

          roomBookings.forEach((b) => {
            // Offsets are fractional day counts from the 1st of the visible month,
            // so a check-in/out time of e.g. 14:00 lands 14/24 of the way across
            // that day's column instead of the bar filling the whole day box.
            const startOffset = Math.max(0, dtOffsetFromDate(b.checkIn, monthStartStr));
            const endOffset = Math.min(days.length, dtOffsetFromDate(b.checkOut, monthStartStr));
            const status = b.checkOut < NOW_STR ? "past" : b.checkIn <= NOW_STR ? "current" : "upcoming";
            const tooltip = `${b.guestName}${b.designation ? " — " + b.designation : ""}${b.contact ? " — " + b.contact : ""} — ${formatDateTime(b.checkIn)} to ${formatDateTime(b.checkOut)}${b.comment ? " — " + b.comment : ""}`;
            const left = startOffset * DAY_W + 2;
            const width = Math.max((endOffset - startOffset) * DAY_W - 4, 6);
            html += `<div class="chm-bar chm-bar-${status}" data-booking-id="${b.id}"
                style="left:${left}px;width:${width}px" title="${escapeHtml(tooltip)}">${escapeHtml(b.guestName)}</div>`;
          });

          html += `</div>`;
        });
      });
    }

    el.ganttGrid.innerHTML = html;

    el.ganttGrid.querySelectorAll(".chm-bar").forEach((node) => {
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        const booking = state.bookings.find((b) => b.id === node.getAttribute("data-booking-id"));
        if (booking) openEventPopover(booking, node);
      });
    });

    el.ganttGrid.querySelectorAll(".chm-row-track").forEach((node) => {
      node.addEventListener("click", (e) => {
        const rect = node.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const dayIndex = Math.min(days.length, Math.max(1, Math.floor(x / DAY_W) + 1));
        const dateStr = `${state.viewYear}-${pad2(state.viewMonthIdx + 1)}-${pad2(dayIndex)}`;
        openNew({ roomId: node.getAttribute("data-room-id"), checkIn: `${dateStr}T14:00`, checkOut: `${addDays(dateStr, 1)}T12:00` });
      });
    });
  }

  function renderAll() {
    renderKeyboard();
    renderGantt();
  }

  /* ---------------- event popover (Google-Calendar-style click card) ---------------- */

  function openEventPopover(booking, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    state.popoverState = { bookingId: booking.id, rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width } };
    renderEventPopover();
  }

  function closePopover() {
    state.popoverState = null;
    el.popoverRoot.innerHTML = "";
  }

  function formatPopoverDateRange(checkIn, checkOut) {
    const inDate = checkIn.slice(0, 10);
    const outDate = checkOut.slice(0, 10);
    if (inDate === outDate) return formatFullDate(inDate);
    const [iy, im, id] = inDate.split("-").map(Number);
    const [oy, om, od] = outDate.split("-").map(Number);
    if (iy === oy && im === om) return `${id} – ${od} ${MONTH_SHORT[im - 1]} ${iy}`;
    if (iy === oy) return `${id} ${MONTH_SHORT[im - 1]} – ${od} ${MONTH_SHORT[om - 1]} ${iy}`;
    return `${id} ${MONTH_SHORT[im - 1]} ${iy} – ${od} ${MONTH_SHORT[om - 1]} ${oy}`;
  }

  function renderEventPopover() {
    if (!state.popoverState) return;
    const booking = state.bookings.find((b) => b.id === state.popoverState.bookingId);
    if (!booking) { closePopover(); return; }
    const room = ROOMS_BY_ID[booking.roomId];
    const { rect } = state.popoverState;

    const dateLine = formatPopoverDateRange(booking.checkIn, booking.checkOut);
    const timeLine = `${formatTimeOnly(booking.checkIn)} – ${formatTimeOnly(booking.checkOut)}`;
    const status = booking.checkOut < NOW_STR ? "past" : booking.checkIn <= NOW_STR ? "current" : "upcoming";
    const dotColor = status === "current" ? "var(--emerald)" : status === "upcoming" ? "var(--amber)" : "#9BA6A2";

    el.popoverRoot.innerHTML = `
      <div class="chm-pop-overlay" id="pop-overlay">
        <div class="chm-pop-card" id="pop-card">
          <div class="chm-pop-head">
            <span class="chm-pop-dot" style="background:${dotColor}"></span>
            <div class="chm-pop-title">${escapeHtml(booking.guestName)}</div>
            <button type="button" class="chm-icon-btn" id="pop-close" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="chm-pop-body">
            ${room ? `<div class="chm-pop-room">Room ${room.number}${room.type === "VIP" ? " · VIP" : ""}</div>` : ""}
            <div class="chm-pop-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              <span>${escapeHtml(dateLine)}</span>
            </div>
            <div class="chm-pop-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
              <span>${escapeHtml(timeLine)}</span>
            </div>
            ${booking.designation ? `<div class="chm-pop-sub">${escapeHtml(booking.designation)}</div>` : ""}
          </div>
          <div class="chm-pop-actions">
            <button type="button" class="chm-btn-ghost" id="pop-edit">Edit details</button>
          </div>
        </div>
      </div>`;

    document.getElementById("pop-overlay").addEventListener("click", (e) => {
      if (e.target.id === "pop-overlay") closePopover();
    });
    document.getElementById("pop-close").addEventListener("click", closePopover);
    document.getElementById("pop-edit").addEventListener("click", () => {
      closePopover();
      openEdit(booking);
    });

    // Position the card next to the clicked bar, like Google Calendar's event
    // popover, clamped so it never runs off the viewport edges.
    const card = document.getElementById("pop-card");
    const cardW = card.offsetWidth;
    const cardH = card.offsetHeight;
    const margin = 10;
    let left = rect.left;
    let top = rect.bottom + margin;
    if (top + cardH > window.innerHeight - margin) top = rect.top - cardH - margin;
    if (top < margin) top = margin;
    if (left + cardW > window.innerWidth - margin) left = window.innerWidth - cardW - margin;
    if (left < margin) left = margin;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  /* ---------------- modal ---------------- */

  function optionsMarkup(selectedRoomId) {
    return FLOORS_LIST.map((floor) => {
      const opts = ROOMS.filter((r) => r.floor === floor)
        .map(
          (r) =>
            `<option value="${r.id}" ${r.id === selectedRoomId ? "selected" : ""}>Room ${r.number}${r.type === "VIP" ? " · VIP" : ""}</option>`
        )
        .join("");
      return `<optgroup label="Floor ${floor}">${opts}</optgroup>`;
    }).join("");
  }

  function openNew(prefill) {
    const p = prefill || {};
    state.modalState = {
      mode: "new",
      booking: {
        roomId: p.roomId || ROOMS[0].id,
        guestName: "",
        designation: "",
        contact: "",
        comment: "",
        checkIn: p.checkIn || `${TODAY_STR}T14:00`,
        checkOut: p.checkOut || `${addDays(TODAY_STR, 1)}T12:00`,
      },
    };
    renderModal();
  }

  function openEdit(booking) {
    state.modalState = { mode: "edit", booking };
    renderModal();
  }

  function closeModal() {
    state.modalState = null;
    el.modalRoot.innerHTML = "";
  }

  function renderModal() {
    const { mode, booking } = state.modalState;
    const isEdit = mode === "edit";

    el.modalRoot.innerHTML = `
      <div class="chm-overlay" id="modal-overlay">
        <form class="chm-modal" id="booking-form">
          <div class="chm-modal-head">
            <h3>${isEdit ? "Edit booking" : "New booking"}</h3>
            <button type="button" class="chm-icon-btn" id="modal-close" aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <label class="chm-field">
            <span>Room</span>
            <select id="f-room">${optionsMarkup(booking.roomId)}</select>
          </label>

          <label class="chm-field">
            <span>Guest name</span>
            <input id="f-guest" value="${escapeHtml(booking.guestName)}" placeholder="e.g. Md. Kamal Hossain" autofocus />
          </label>

          <div class="chm-field-row">
            <label class="chm-field">
              <span>Designation / office</span>
              <input id="f-designation" value="${escapeHtml(booking.designation)}" placeholder="e.g. Asst. Commissioner (Land)" />
            </label>
            <label class="chm-field">
              <span>Contact number</span>
              <input id="f-contact" value="${escapeHtml(booking.contact)}" placeholder="e.g. 01xxxxxxxxx" />
            </label>
          </div>

          <div class="chm-field-row">
            <label class="chm-field">
              <span>Check-in (date &amp; time)</span>
              <input type="datetime-local" id="f-checkin" value="${booking.checkIn.length > 10 ? booking.checkIn : booking.checkIn + "T14:00"}" />
            </label>
            <label class="chm-field">
              <span>Check-out (date &amp; time)</span>
              <input type="datetime-local" id="f-checkout" value="${booking.checkOut.length > 10 ? booking.checkOut : booking.checkOut + "T12:00"}" />
            </label>
          </div>

          <label class="chm-field">
            <span>Comment</span>
            <textarea id="f-comment" rows="3" placeholder="Any note about this booking (e.g. purpose of visit, special request)…">${escapeHtml(booking.comment || "")}</textarea>
          </label>

          <div id="modal-error"></div>

          <div class="chm-modal-actions">
            ${isEdit ? `<button type="button" class="chm-btn-danger" id="modal-delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
                Delete
              </button>` : ""}
            <div style="flex:1"></div>
            <button type="button" class="chm-btn-ghost" id="modal-cancel">Cancel</button>
            <button type="submit" class="chm-btn-primary">Save</button>
          </div>
        </form>
      </div>`;

    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") closeModal();
    });
    document.getElementById("booking-form").addEventListener("click", (e) => e.stopPropagation());
    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("modal-cancel").addEventListener("click", closeModal);
    if (isEdit) {
      document.getElementById("modal-delete").addEventListener("click", async () => {
        await deleteBooking(booking.id);
        closeModal();
      });
    }
    document.getElementById("booking-form").addEventListener("submit", handleSubmit);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const data = {
      roomId: document.getElementById("f-room").value,
      guestName: document.getElementById("f-guest").value.trim(),
      designation: document.getElementById("f-designation").value.trim(),
      contact: document.getElementById("f-contact").value.trim(),
      comment: document.getElementById("f-comment").value.trim(),
      checkIn: document.getElementById("f-checkin").value,
      checkOut: document.getElementById("f-checkout").value,
    };
    const errBox = document.getElementById("modal-error");

    if (!data.guestName) {
      errBox.innerHTML = `<div class="chm-error">Guest name is required.</div>`;
      return;
    }
    if (data.checkOut < data.checkIn) {
      errBox.innerHTML = `<div class="chm-error">Check-out must be on or after check-in.</div>`;
      return;
    }

    const { mode, booking } = state.modalState;
    const err = mode === "edit" ? await updateBooking(booking.id, data) : await createBooking(data);
    if (err) {
      errBox.innerHTML = `<div class="chm-error">${escapeHtml(err)}</div>`;
      return;
    }
    closeModal();
  }

  /* ---------------- API calls ---------------- */

  async function createBooking(data) {
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.status === 401) { window.location.href = "/login"; return "Session expired."; }
      const body = await res.json();
      if (!res.ok) return body.error || "Could not save booking.";
      state.bookings.push(body);
      renderAll();
      return null;
    } catch (e) {
      return "Network error — please try again.";
    }
  }

  async function updateBooking(id, data) {
    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.status === 401) { window.location.href = "/login"; return "Session expired."; }
      const body = await res.json();
      if (!res.ok) return body.error || "Could not save booking.";
      state.bookings = state.bookings.map((b) => (b.id === id ? body : b));
      renderAll();
      return null;
    } catch (e) {
      return "Network error — please try again.";
    }
  }

  async function deleteBooking(id) {
    try {
      await fetch(`/api/bookings/${id}`, { method: "DELETE" });
      state.bookings = state.bookings.filter((b) => b.id !== id);
      renderAll();
      if (state.popoverState && state.popoverState.bookingId === id) closePopover();
    } catch (e) {
      showNotice("Could not delete booking. Please try again.");
    }
  }

  /* ---------------- toolbar & nav ---------------- */

  function changeMonth(delta) {
    let m = state.viewMonthIdx + delta;
    let y = state.viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    state.viewYear = y;
    state.viewMonthIdx = m;
    renderGantt();
  }

  document.getElementById("prev-month").addEventListener("click", () => changeMonth(-1));
  document.getElementById("next-month").addEventListener("click", () => changeMonth(1));
  document.getElementById("today-btn").addEventListener("click", () => {
    state.viewYear = TODAY.getFullYear();
    state.viewMonthIdx = TODAY.getMonth();
    renderGantt();
  });
  document.getElementById("search-input").addEventListener("input", (e) => {
    state.search = e.target.value;
    closePopover();
    renderGantt();
  });
  document.getElementById("new-booking-btn").addEventListener("click", () => openNew());

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.modalState) closeModal();
    else if (state.popoverState) closePopover();
  });

  /* ---------------- init ---------------- */

  fetchBookings();
})();
