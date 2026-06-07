// ============================================================
const EMAILJS_PUBLIC_KEY  = "IEkHLZHrYCWc4pf7C";   
const EMAILJS_SERVICE_ID  = "service_3kwnvvo";  
const EMAILJS_TEMPLATE_ID = "template_zttupwj";  

function isEmailJSConfigured() {
  return EMAILJS_PUBLIC_KEY  !== "IEkHLZHrYCWc4pf7C"  &&
         EMAILJS_SERVICE_ID  !== "service_3kwnvvo"  &&
         EMAILJS_TEMPLATE_ID !== "template_zttupwj" &&
         EMAILJS_PUBLIC_KEY.length > 0;
}

// ---------- DATA STORE ----------
const DEFAULT_EMAILS = [
  { id: 1, sender: "MailSoft Team", email: "team@mailsoft.com", subject: "Welcome to MailSoft 🎉", body: "Hi Arpna,\n\nYour account has been created successfully. We're thrilled to have you on board!\n\nExplore your inbox, compose emails, star important messages, and stay organised.\n\nHappy emailing!\n— MailSoft Team", time: "9:00 AM", tag: "Welcome", tagClass: "tag-primary", read: false, starred: false, folder: "inbox" },
  { id: 2, sender: "Team Calendar", email: "calendar@company.com", subject: "Meeting Reminder", body: "Hi Arpna,\n\nThis is a reminder that tomorrow's standup meeting is scheduled at 10:00 AM.\n\nAgenda:\n• Sprint review\n• Blockers discussion\n• Planning for next sprint\n\nPlease be on time. See you there!", time: "8:30 AM", tag: "Reminder", tagClass: "tag-warning", read: false, starred: false, folder: "inbox" },
  { id: 3, sender: "Professor Sharma", email: "sharma@university.edu", subject: "Project Submission Confirmed", body: "Dear Arpna,\n\nYour project has been received and confirmed successfully.\n\nTitle: Email Client Software\nSubmitted: On time\nGrade review: Pending\n\nGood work! Keep it up.\n\nRegards,\nProfessor Sharma", time: "Yesterday", tag: "Confirmed", tagClass: "tag-success", read: true, starred: false, folder: "inbox" },
];

let emails = { inbox: [], sent: [], drafts: [], trash: [] };

let currentFolder   = "inbox";
let currentEmailId  = null;  
let composeMode     = "new"; 
let composingDraftId = null;
let composingAttachments = [];
let notifications   = [];
let searchTimeout   = null;
let globalSearchActive = false;

const MAX_FILE_SIZE  = 5  * 1024 * 1024;
const MAX_TOTAL_SIZE = 25 * 1024 * 1024;

// ============================================================
//  PERSISTENCE
// ============================================================
function saveToStorage() {
  try { localStorage.setItem("mailsoft-emails", JSON.stringify(emails)); } catch(e) {}
  try { localStorage.setItem("mailsoft-notifs", JSON.stringify(notifications)); } catch(e) {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem("mailsoft-emails");
    if (raw) {
      const parsed = JSON.parse(raw);
      emails.inbox  = parsed.inbox  || DEFAULT_EMAILS.filter(e => e.folder === "inbox");
      emails.sent   = parsed.sent   || [];
      emails.drafts = parsed.drafts || [];
      emails.trash  = parsed.trash  || [];
    } else {
      emails.inbox = DEFAULT_EMAILS.slice();
    }
  } catch(e) {
    emails.inbox = DEFAULT_EMAILS.slice();
  }
  try {
    const rn = localStorage.getItem("mailsoft-notifs");
    if (rn) notifications = JSON.parse(rn);
  } catch(e) {}
}

// ============================================================
//  MOBILE SIDEBAR
// ============================================================
function toggleSidebar() {
  const sidebar  = document.getElementById("sidebar");
  const overlay  = document.getElementById("sidebarOverlay");
  const isOpen   = sidebar.classList.contains("open");
  if (isOpen) {
    closeSidebar();
  } else {
    sidebar.classList.add("open");
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";
  }
}

function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").classList.remove("active");
  document.body.style.overflow = "";
}

// ============================================================
//  INIT
// ============================================================
window.onload = function () {
  loadFromStorage();
  if (isEmailJSConfigured()) {
    emailjs.init(EMAILJS_PUBLIC_KEY);
  }
  loadTheme();
  renderFolder("inbox");
  updateCounts();
  renderNotifPanel();

  const unread = emails.inbox.filter(e => !e.read).length;
  showToast(unread > 0 ? `✉️ Welcome back, Arpna! You have ${unread} unread email${unread > 1 ? "s" : ""}.` : "✉️ Welcome back, Arpna!");

  // Outside-click: close panels
  document.addEventListener("click", function (e) {
    const inCompose  = e.target.closest("#composePopup");
    const opensComp  = e.target.closest(".compose-btn") || e.target.closest("[onclick*='openCompose']") || e.target.closest("[onclick*='replyEmail']") || e.target.closest("[onclick*='forwardEmail']") || e.target.closest(".mobile-fab");
    if (!inCompose && !opensComp) closeCompose();

    if (!e.target.closest("#notifPanel") && !e.target.closest("#notifBell") && !e.target.closest("#notifBellMobile"))
      document.getElementById("notifPanel").classList.remove("open");
    if (!e.target.closest("#profileMenu") && !e.target.closest(".profile"))
      document.getElementById("profileMenu").classList.remove("open");
  });

  // Char counter
  document.getElementById("popupMessage").addEventListener("input", function () {
    document.getElementById("charCount").textContent = this.innerText.length;
  });

  // Sync mobile search input with desktop search
  const mobileSearch = document.getElementById("searchInputMobile");
  if (mobileSearch) {
    mobileSearch.addEventListener("input", function () {
      document.getElementById("searchInput").value = this.value;
      searchMail();
    });
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeCompose();
      closeSidebar();
      document.getElementById("notifPanel").classList.remove("open");
      document.getElementById("profileMenu").classList.remove("open");
      document.querySelectorAll(".info-modal").forEach(m => m.remove());
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      if (document.getElementById("composePopup").classList.contains("open"))
        sendMailFromPopup();
    }
    if (e.key === "n" && !e.target.matches("input,textarea,[contenteditable]")) {
      openCompose();
    }
  });

  // Auto-save draft every 30s
  setInterval(function () {
    if (document.getElementById("composePopup").classList.contains("open")) {
      const body = document.getElementById("popupMessage").innerText.trim();
      if (body.length > 0) autoSaveDraft();
    }
  }, 30000);
};

// ============================================================
//  FOLDER SWITCHING
// ============================================================
function switchFolder(folder) {
  currentFolder = folder;

  if (globalSearchActive) {
    globalSearchActive = false;
    document.getElementById("searchInput").value = "";
    const mob = document.getElementById("searchInputMobile");
    if (mob) mob.value = "";
    const banner = document.getElementById("globalSearchBanner");
    if (banner) banner.remove();
  }

  closeDetail();

  document.querySelectorAll("#sidebarNav li").forEach(li => li.classList.remove("active"));
  document.querySelector(`[data-folder="${folder}"]`).classList.add("active");

  const icons  = { inbox:"fa-inbox", sent:"fa-paper-plane", drafts:"fa-file-alt", starred:"fa-star", trash:"fa-trash" };
  const labels = { inbox:"Inbox",    sent:"Sent",           drafts:"Drafts",       starred:"Starred", trash:"Trash"   };
  document.getElementById("folderTitle").innerHTML = `<i class="fa ${icons[folder]}"></i> ${labels[folder]}`;

  const isInbox = folder === "inbox";
  document.getElementById("heroSection").style.display  = isInbox ? "flex"  : "none";
  document.getElementById("infoSection").style.display  = isInbox ? "block" : "none";

  const et = document.getElementById("emptyTrashBtn");
  if (et) et.style.display = folder === "trash" ? "inline-flex" : "none";

  renderFolder(folder);
}

// ============================================================
//  RENDER FOLDER
// ============================================================
function renderFolder(folder) {
  const list  = document.getElementById("mailList");
  const empty = document.getElementById("emptyState");
  list.innerHTML = "";

  const data = getDisplayEmails(folder);

  if (data.length === 0) {
    empty.style.display = "flex";
    const icons = { inbox:"fa-inbox", sent:"fa-paper-plane", drafts:"fa-file-alt", starred:"fa-star", trash:"fa-trash" };
    empty.innerHTML = `<i class="fa ${icons[folder] || 'fa-inbox'}"></i><p>No emails in ${folder}</p>`;
    return;
  }
  empty.style.display = "none";

  data.forEach(function (email) {
    const card = document.createElement("div");
    card.className = `email-card mail-item ${!email.read ? "unread" : ""} ${email.starred ? "starred-card" : ""}`;
    card.dataset.id = email.id;

    const attachIcon = email.attachments && email.attachments.length
      ? `<i class="fa fa-paperclip att-icon" title="${email.attachments.length} attachment(s)" style="color:var(--text-muted);font-size:13px"></i>`
      : "";

    const trashIcon = folder === "trash"
      ? `<i class="fa fa-undo restore-icon" title="Restore" onclick="restoreEmailById(event,${email.id})"></i>`
      : "";

    card.innerHTML = `
      <div class="card-top">
        <input type="checkbox" class="select-cb" onclick="event.stopPropagation()" />
        <div class="email-meta">
          <span class="sender">${escHtml(email.sender)}</span>
          <span class="time">${escHtml(email.time)}</span>
        </div>
        <div class="card-icons">
          <i class="fa fa-star star-btn ${email.starred ? "starred" : ""}" onclick="toggleStar(event,${email.id},'${folder}')"></i>
          ${attachIcon}
          ${trashIcon}
          <i class="fa fa-trash del-btn" title="${folder === 'trash' ? 'Delete permanently' : 'Move to trash'}" onclick="moveToTrash(event,${email.id},'${folder}')"></i>
        </div>
      </div>
      <h3>${escHtml(email.subject)}</h3>
      <p>${escHtml(email.body.substring(0, 100))}...</p>
      ${email.tag ? `<span class="tag ${email.tagClass}">${escHtml(email.tag)}</span>` : ""}
    `;

    card.addEventListener("click", function (e) {
      if (e.target.classList.contains("select-cb") || e.target.closest(".card-icons")) return;
      openEmail(email.id, folder);
    });

    list.appendChild(card);
  });
}

function getDisplayEmails(folder) {
  if (folder === "starred") {
    return [...emails.inbox, ...emails.sent, ...emails.drafts].filter(e => e.starred);
  }
  return emails[folder] || [];
}

// ============================================================
//  OPEN / READ EMAIL
// ============================================================
function openEmail(id, folder) {
  const email = findEmail(id, folder);
  if (!email) return;

  if (folder === "drafts") {
    openDraftForEdit(email);
    return;
  }

  email.read = true;
  currentEmailId = { id, folder };
  updateCounts();
  saveToStorage();

  document.getElementById("mailList").style.display = "none";
  document.getElementById("folderTitle").parentElement.style.display = "none";
  document.getElementById("emptyState").style.display = "none";
  document.getElementById("emailDetail").style.display = "block";

  document.getElementById("detailSubject").textContent = email.subject;
  let senderHtml = `<i class="fa fa-user-circle"></i> <strong>${escHtml(email.sender)}</strong> &lt;${escHtml(email.email)}&gt;`;
  if (email.cc) senderHtml += `&nbsp;&nbsp;<span style="color:var(--text-muted);font-size:12px">CC: ${escHtml(email.cc)}</span>`;
  document.getElementById("detailSender").innerHTML = senderHtml;
  document.getElementById("detailTime").textContent = email.time;
  document.getElementById("detailBody").innerHTML = escHtml(email.body).replace(/\n/g, "<br>");

  const rb = document.getElementById("restoreBtn");
  if (rb) rb.style.display = folder === "trash" ? "inline-flex" : "none";

  if (email.attachments && email.attachments.length) {
    let html = `<div class="detail-attachments"><div class="att-label"><i class="fa fa-paperclip"></i> Attachments (${email.attachments.length})</div>`;
    email.attachments.forEach(att => {
      html += `<a class="att-chip" href="${att.data}" download="${escHtml(att.name)}" target="_blank">
        <i class="fa fa-file"></i> ${escHtml(att.name)} <span class="att-size">${formatBytes(att.size)}</span>
      </a>`;
    });
    html += "</div>";
    document.getElementById("detailBody").innerHTML += html;
  }

  renderFolder(folder);
  // Scroll to top on mobile
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeDetail() {
  document.getElementById("emailDetail").style.display = "none";
  document.getElementById("mailList").style.display = "block";
  document.getElementById("folderTitle").parentElement.style.display = "flex";
  currentEmailId = null;
  renderFolder(currentFolder);
}

function deleteCurrentEmail() {
  if (!currentEmailId) return;
  moveToTrash(null, currentEmailId.id, currentEmailId.folder);
  closeDetail();
}

// ============================================================
//  RESTORE FROM TRASH
// ============================================================
function restoreEmail() {
  if (!currentEmailId || currentEmailId.folder !== "trash") return;
  _doRestore(currentEmailId.id);
  closeDetail();
}

function restoreEmailById(e, id) {
  if (e) e.stopPropagation();
  _doRestore(id);
  renderFolder(currentFolder);
}

function _doRestore(id) {
  const idx = emails.trash.findIndex(e => e.id === id);
  if (idx === -1) return;
  const [item] = emails.trash.splice(idx, 1);
  const dest = item.originalFolder || "inbox";
  emails[dest] = emails[dest] || [];
  emails[dest].unshift(item);
  addNotif(`♻️ Restored "${item.subject}" to ${dest}`);
  showToast(`♻️ Restored to ${dest}`);
  updateCounts();
  saveToStorage();
}

// ============================================================
//  REPLY / FORWARD
// ============================================================
function replyEmail() {
  if (!currentEmailId) return;
  const email = findEmail(currentEmailId.id, currentEmailId.folder);
  if (!email) return;
  composeMode = "reply";
  document.getElementById("composeTitle").textContent = "Reply";
  document.getElementById("popupTo").value = email.email;
  document.getElementById("popupCc").value = email.cc || "";
  document.getElementById("popupSubject").value = email.subject.startsWith("Re:") ? email.subject : "Re: " + email.subject;
  document.getElementById("popupMessage").innerHTML =
    `<br><br><span style="color:var(--text-muted)">--- Original message from ${escHtml(email.sender)} ---</span><br>${escHtml(email.body).replace(/\n/g,"<br>")}`;
  document.getElementById("charCount").textContent = document.getElementById("popupMessage").innerText.length;
  composingAttachments = [];
  updateAttachmentUI();
  document.getElementById("composePopup").classList.add("open");
  document.getElementById("popupMessage").focus();
}

function forwardEmail() {
  if (!currentEmailId) return;
  const email = findEmail(currentEmailId.id, currentEmailId.folder);
  if (!email) return;
  composeMode = "forward";
  document.getElementById("composeTitle").textContent = "Forward";
  document.getElementById("popupTo").value = "";
  document.getElementById("popupCc").value = "";
  document.getElementById("popupSubject").value = email.subject.startsWith("Fwd:") ? email.subject : "Fwd: " + email.subject;
  document.getElementById("popupMessage").innerHTML =
    `<br><br><span style="color:var(--text-muted)">--- Forwarded message from ${escHtml(email.sender)} ---</span><br>${escHtml(email.body).replace(/\n/g,"<br>")}`;
  document.getElementById("charCount").textContent = document.getElementById("popupMessage").innerText.length;
  composingAttachments = email.attachments ? email.attachments.slice() : [];
  updateAttachmentUI();
  document.getElementById("composePopup").classList.add("open");
  setTimeout(() => document.getElementById("popupTo").focus(), 80);
}

// ============================================================
//  STAR / TRASH
// ============================================================
function toggleStar(e, id, folder) {
  e.stopPropagation();
  const email = findEmail(id, folder);
  if (!email) return;
  email.starred = !email.starred;
  showToast(email.starred ? "⭐ Starred" : "✩ Unstarred");
  saveToStorage();
  renderFolder(currentFolder);
}

function moveToTrash(e, id, folder) {
  if (e) e.stopPropagation();

  let src = folder;
  if (folder === "starred") {
    src = emails.inbox.find(em => em.id === id) ? "inbox"
        : emails.sent.find(em => em.id === id)  ? "sent"
        : emails.drafts.find(em => em.id === id) ? "drafts"
        : "inbox";
  }

  if (src === "trash") {
    emails.trash = emails.trash.filter(em => em.id !== id);
    showToast("🗑️ Permanently deleted");
    addNotif("🗑️ An email was permanently deleted");
  } else {
    const idx = emails[src].findIndex(em => em.id === id);
    if (idx === -1) return;
    const [removed] = emails[src].splice(idx, 1);
    removed.originalFolder = src;
    emails.trash.push(removed);
    showToast("🗑️ Moved to Trash");
    addNotif(`🗑️ Moved "${removed.subject}" to Trash`);
  }
  updateCounts();
  saveToStorage();
  renderFolder(currentFolder);
}

function emptyTrash() {
  if (!emails.trash.length) { showToast("ℹ️ Trash is already empty"); return; }
  if (!confirm(`Permanently delete all ${emails.trash.length} email(s) in Trash? This cannot be undone.`)) return;
  const count = emails.trash.length;
  emails.trash = [];
  showToast(`🗑️ ${count} email(s) permanently deleted`);
  addNotif(`🗑️ Emptied trash — ${count} email(s) deleted`);
  updateCounts();
  saveToStorage();
  renderFolder("trash");
}

// ============================================================
//  MARK ALL READ
// ============================================================
function markAllRead() {
  getDisplayEmails(currentFolder).forEach(e => e.read = true);
  updateCounts();
  saveToStorage();
  renderFolder(currentFolder);
  showToast("✅ All marked as read");
}

// ============================================================
//  DELETE SELECTED
// ============================================================
function deleteSelected() {
  const cbs = document.querySelectorAll(".select-cb:checked");
  if (!cbs.length) { showToast("⚠️ Select at least one email first", "var(--warning)"); return; }
  const ids = Array.from(cbs).map(cb => parseInt(cb.closest(".email-card").dataset.id));
  ids.forEach(id => moveToTrash(null, id, currentFolder));
}

// ============================================================
//  GLOBAL SEARCH
// ============================================================
function searchMail() {
  const q = document.getElementById("searchInput").value.toLowerCase().trim();
  _doSearch(q);
}

function searchMailMobile() {
  const q = document.getElementById("searchInputMobile").value.toLowerCase().trim();
  document.getElementById("searchInput").value = document.getElementById("searchInputMobile").value;
  _doSearch(q);
}

function _doSearch(q) {
  if (!q) {
    globalSearchActive = false;
    const banner = document.getElementById("globalSearchBanner");
    if (banner) banner.remove();
    renderFolder(currentFolder);
    document.getElementById("emptyState").style.display = "none";
    return;
  }

  globalSearchActive = true;

  const allEmails = [
    ...emails.inbox.map(e  => ({...e, _srcFolder: "inbox"})),
    ...emails.sent.map(e   => ({...e, _srcFolder: "sent"})),
    ...emails.drafts.map(e => ({...e, _srcFolder: "drafts"})),
    ...emails.trash.map(e  => ({...e, _srcFolder: "trash"})),
  ];

  const results = allEmails.filter(e =>
    e.subject.toLowerCase().includes(q) ||
    e.body.toLowerCase().includes(q)    ||
    e.sender.toLowerCase().includes(q)  ||
    e.email.toLowerCase().includes(q)
  );

  const list  = document.getElementById("mailList");
  const empty = document.getElementById("emptyState");
  list.innerHTML = "";

  let banner = document.getElementById("globalSearchBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "globalSearchBanner";
    banner.className = "search-banner";
    list.before(banner);
  }
  banner.innerHTML = `<i class="fa fa-search"></i> ${results.length} result${results.length !== 1 ? "s" : ""} for "<strong>${escHtml(q)}</strong>" across all folders`;

  if (!results.length) {
    empty.style.display = "flex";
    empty.innerHTML = `<i class="fa fa-search"></i><p>No emails found for "<strong>${escHtml(q)}</strong>"</p>`;
    return;
  }
  empty.style.display = "none";

  results.forEach(function (email) {
    const card = document.createElement("div");
    card.className = `email-card mail-item ${!email.read ? "unread" : ""} ${email.starred ? "starred-card" : ""}`;
    card.dataset.id = email.id;

    card.innerHTML = `
      <div class="card-top">
        <div class="email-meta">
          <span class="sender">${escHtml(email.sender)}</span>
          <span class="time">${escHtml(email.time)}</span>
        </div>
        <span class="folder-badge">${email._srcFolder}</span>
      </div>
      <h3>${highlight(email.subject, q)}</h3>
      <p>${highlight(email.body.substring(0, 100), q)}...</p>
      ${email.tag ? `<span class="tag ${email.tagClass}">${escHtml(email.tag)}</span>` : ""}
    `;

    card.addEventListener("click", function () {
      openEmail(email.id, email._srcFolder);
    });

    list.appendChild(card);
  });
}

function highlight(text, q) {
  const safe = escHtml(text);
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return safe.replace(re, `<mark>$1</mark>`);
}

// ============================================================
//  COMPOSE
// ============================================================
function openCompose() {
  composeMode = "new";
  composingDraftId = null;
  composingAttachments = [];
  document.getElementById("composeTitle").textContent = "New Message";
  document.getElementById("popupTo").value = "";
  document.getElementById("popupCc").value = "";
  document.getElementById("popupSubject").value = "";
  document.getElementById("popupMessage").innerHTML = "";
  document.getElementById("charCount").textContent = "0";
  updateAttachmentUI();
  document.getElementById("composePopup").classList.add("open");
  setTimeout(() => document.getElementById("popupTo").focus(), 80);
}

function closeCompose() {
  document.getElementById("composePopup").classList.remove("open");
}

function openDraftForEdit(email) {
  composeMode = "draft";
  composingDraftId = email.id;
  composingAttachments = email.attachments ? email.attachments.slice() : [];
  document.getElementById("composeTitle").textContent = "Edit Draft";
  document.getElementById("popupTo").value = email.email === "—" ? "" : email.email;
  document.getElementById("popupCc").value = email.cc || "";
  document.getElementById("popupSubject").value = email.subject === "(No subject)" ? "" : email.subject;
  document.getElementById("popupMessage").innerHTML = email.body === "(Empty draft)" ? "" : escHtml(email.body).replace(/\n/g, "<br>");
  document.getElementById("charCount").textContent = document.getElementById("popupMessage").innerText.length;
  updateAttachmentUI();
  document.getElementById("composePopup").classList.add("open");
  setTimeout(() => document.getElementById("popupMessage").focus(), 80);
}

function sendMailFromPopup() {
  const to      = document.getElementById("popupTo").value.trim();
  const cc      = document.getElementById("popupCc").value.trim();
  const subject = document.getElementById("popupSubject").value.trim();
  const body    = document.getElementById("popupMessage").innerText.trim();

  if (!to)      { showToast("⚠️ 'To' field is required", "var(--danger)"); document.getElementById("popupTo").focus(); return; }
  if (!subject) { showToast("⚠️ Subject is required", "var(--danger)"); document.getElementById("popupSubject").focus(); return; }
  if (!body)    { showToast("⚠️ Message cannot be empty", "var(--danger)"); document.getElementById("popupMessage").focus(); return; }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(to)) { showToast("⚠️ Enter a valid 'To' email address", "var(--danger)"); document.getElementById("popupTo").focus(); return; }
  if (cc && !emailRe.test(cc)) { showToast("⚠️ Enter a valid CC email address", "var(--danger)"); document.getElementById("popupCc").focus(); return; }

  const sent = {
    id: Date.now(),
    sender: "Arpna (You)",
    email: to, cc,
    subject, body,
    attachments: composingAttachments.slice(),
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    tag: "Sent", tagClass: "tag-primary",
    read: true, starred: false, originalFolder: "sent"
  };
  emails.sent.unshift(sent);

  if (composeMode === "draft" && composingDraftId) {
    emails.drafts = emails.drafts.filter(d => d.id !== composingDraftId);
    composingDraftId = null;
  }
  composeMode = "new";
  composingAttachments = [];
  updateCounts();
  saveToStorage();

  if (isEmailJSConfigured()) {
    const sendBtn = document.querySelector(".btn-send");
    if (sendBtn) { sendBtn.disabled = true; sendBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Sending...'; }

    emailjs.init(EMAILJS_PUBLIC_KEY);
    const templateParams = {
      to_email:  to, cc_email: cc || "", subject, message: body,
      from_name: "Arpna via MailSoft", reply_to: "arpna@mailsoft.com"
    };

    emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams)
      .then(function (response) {
        closeCompose();
        addNotif("📤 Real email sent to " + to);
        showToast("✅ Email sent to " + to + "!");
        if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = '<i class="fa fa-paper-plane"></i> Send'; }
      })
      .catch(function (error) {
        closeCompose();
        addNotif("⚠️ EmailJS error — saved to Sent locally");
        showToast("⚠️ Real send failed: " + (error.text || error), "var(--danger)");
        if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = '<i class="fa fa-paper-plane"></i> Send'; }
      });
  } else {
    closeCompose();
    addNotif("📤 Email saved to Sent (simulation mode)");
    showToast("✅ Saved to Sent!");
  }
}

// ============================================================
//  DRAFTS
// ============================================================
function saveDraft() {
  _persistDraft();
  closeCompose();
  showToast("💾 Draft saved");
}

function autoSaveDraft() {
  _persistDraft(true);
}

function _persistDraft(silent) {
  const to      = document.getElementById("popupTo").value.trim();
  const cc      = document.getElementById("popupCc").value.trim();
  const subject = document.getElementById("popupSubject").value.trim() || "(No subject)";
  const body    = document.getElementById("popupMessage").innerText.trim() || "(Empty draft)";

  if (composeMode === "draft" && composingDraftId) {
    const idx = emails.drafts.findIndex(d => d.id === composingDraftId);
    if (idx > -1) {
      Object.assign(emails.drafts[idx], { email: to || "—", cc, subject, body, attachments: composingAttachments.slice(), time: now() });
      if (!silent) saveToStorage();
      updateCounts();
      return;
    }
  }

  const draft = {
    id: Date.now(),
    sender: "Arpna (Draft)", email: to || "—", cc, subject, body,
    attachments: composingAttachments.slice(),
    time: now(),
    tag: "Draft", tagClass: "tag-warning",
    read: true, starred: false, originalFolder: "drafts"
  };
  emails.drafts.unshift(draft);
  composingDraftId = draft.id;
  composeMode = "draft";
  updateCounts();
  saveToStorage();
}

// ============================================================
//  ATTACHMENTS
// ============================================================
function handleAttachments(e) {
  Array.from(e.target.files || []).forEach(function (file) {
    if (file.size > MAX_FILE_SIZE) {
      showToast(`⚠️ ${file.name} exceeds 5 MB limit`, "var(--danger)"); return;
    }
    const currentTotal = composingAttachments.reduce((s, a) => s + (a.size || 0), 0);
    if (currentTotal + file.size > MAX_TOTAL_SIZE) {
      showToast(`⚠️ Total attachments exceed 25 MB`, "var(--danger)"); return;
    }
    const reader = new FileReader();
    reader.onload = function (ev) {
      composingAttachments.push({ name: file.name, type: file.type, data: ev.target.result, size: file.size });
      updateAttachmentUI();
      showToast(`📎 Attached: ${file.name}`);
    };
    reader.readAsDataURL(file);
  });
  e.target.value = "";
}

function updateAttachmentUI() {
  const list = document.getElementById("attachmentList");
  if (!list) return;
  list.innerHTML = "";
  if (!composingAttachments.length) return;

  composingAttachments.forEach(function (att, idx) {
    const pill = document.createElement("div");
    pill.className = "att-pill";
    pill.innerHTML = `<i class="fa fa-file"></i> ${escHtml(att.name)} <span class="att-size">${formatBytes(att.size)}</span>
      <button onclick="removeAttachment(${idx})" title="Remove"><i class="fa fa-times"></i></button>`;
    list.appendChild(pill);
  });

  const total = composingAttachments.reduce((s, a) => s + (a.size || 0), 0);
  const info  = document.createElement("div");
  info.className = "att-total";
  info.textContent = `Total: ${formatBytes(total)} / 25 MB`;
  list.appendChild(info);
}

function removeAttachment(idx) {
  const removed = composingAttachments.splice(idx, 1);
  updateAttachmentUI();
  showToast(`Removed: ${removed[0].name}`);
}

function formatBytes(b) {
  if (!b) return "0 B";
  const k = 1024, s = ["B","KB","MB","GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + " " + s[i];
}

// ============================================================
//  COUNTS
// ============================================================
function updateCounts() {
  const unread = emails.inbox.filter(e => !e.read).length;
  const ic = document.getElementById("inboxCount");
  ic.textContent = unread;
  ic.style.display = unread > 0 ? "inline-block" : "none";

  const dc = document.getElementById("draftCount");
  dc.textContent = emails.drafts.length;
  dc.style.display = emails.drafts.length > 0 ? "inline-block" : "none";

  // Update both desktop and mobile badge
  ["notifBadge", "notifBadgeMobile"].forEach(id => {
    const nb = document.getElementById(id);
    if (nb) {
      nb.textContent = notifications.length;
      nb.style.display = notifications.length > 0 ? "inline" : "none";
    }
  });
}

// ============================================================
//  NOTIFICATIONS
// ============================================================
function addNotif(text) {
  notifications.unshift({ text, time: now() });
  if (notifications.length > 15) notifications = notifications.slice(0, 15);
  updateCounts();
  renderNotifPanel();
  saveToStorage();
}

function renderNotifPanel() {
  const list = document.getElementById("notifList");
  if (!list) return;
  if (!notifications.length) {
    list.innerHTML = `<div class="notif-empty">No new notifications</div>`;
    return;
  }
  list.innerHTML = notifications.map(n =>
    `<div class="notif-item unread-notif"><i class="fa fa-bell" style="color:var(--accent)"></i>
     <div><div>${escHtml(n.text)}</div>${n.time ? `<div style="font-size:11px;color:var(--text-muted)">${n.time}</div>` : ""}</div></div>`
  ).join("");
}

function toggleNotifPanel() {
  document.getElementById("notifPanel").classList.toggle("open");
  document.getElementById("profileMenu").classList.remove("open");
}

function clearNotifs() {
  notifications = [];
  updateCounts();
  renderNotifPanel();
  saveToStorage();
  showToast("🔕 Notifications cleared");
}

// ============================================================
//  PROFILE MENU
// ============================================================
function toggleProfileMenu() {
  document.getElementById("profileMenu").classList.toggle("open");
  document.getElementById("notifPanel").classList.remove("open");
}

function showProfile() {
  document.getElementById("profileMenu").classList.remove("open");
  openModal("My Profile", `
    <div style="text-align:center;margin-bottom:20px">
      <div class="avatar lg" style="margin:0 auto 12px;width:60px;height:60px;font-size:24px;background:linear-gradient(135deg,var(--accent),var(--accent2));border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700">A</div>
      <div style="font-size:18px;font-weight:700">Arpna</div>
      <div style="color:var(--text-muted);font-size:13px">arpna@mailsoft.com</div>
    </div>
    <h3>Account Stats</h3>
    <ul>
      <li><i class="fa fa-envelope"></i> Inbox: ${emails.inbox.length} emails (${emails.inbox.filter(e=>!e.read).length} unread)</li>
      <li><i class="fa fa-paper-plane"></i> Sent: ${emails.sent.length} emails</li>
      <li><i class="fa fa-file-alt"></i> Drafts: ${emails.drafts.length} saved</li>
      <li><i class="fa fa-trash"></i> Trash: ${emails.trash.length} emails</li>
    </ul>
  `);
}

function showSettings() {
  document.getElementById("profileMenu").classList.remove("open");
  openModal("Settings", `
    <div style="display:flex;flex-direction:column;gap:18px">
      <label style="display:flex;justify-content:space-between;align-items:center;font-size:14px">
        <span>Auto-save Drafts (every 30s)</span>
        <input type="checkbox" checked style="accent-color:var(--accent);width:16px;height:16px">
      </label>
      <label style="display:flex;justify-content:space-between;align-items:center;font-size:14px">
        <span>Email Previews in List</span>
        <input type="checkbox" checked style="accent-color:var(--accent);width:16px;height:16px">
      </label>
      <label style="display:flex;justify-content:space-between;align-items:center;font-size:14px">
        <span>Show Unread Count in Tab</span>
        <input type="checkbox" checked style="accent-color:var(--accent);width:16px;height:16px">
      </label>
      <div>
        <label style="font-size:14px;display:block;margin-bottom:6px">Email Signature</label>
        <textarea id="sigInput" placeholder="e.g. Best regards, Arpna" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-family:var(--font-body);min-height:80px;resize:vertical;font-size:14px;outline:none">${localStorage.getItem("mailsoft-sig") || ""}</textarea>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
        <button onclick="this.closest('.info-modal').remove()" style="background:var(--bg);border:1px solid var(--border);color:var(--text-muted);padding:10px 18px;border-radius:8px;cursor:pointer;font-family:var(--font-body)">Cancel</button>
        <button onclick="localStorage.setItem('mailsoft-sig',document.getElementById('sigInput').value);showToast('✅ Settings saved');this.closest('.info-modal').remove()" style="background:var(--accent);color:white;border:none;padding:10px 18px;border-radius:8px;cursor:pointer;font-family:var(--font-body);font-weight:600">Save</button>
      </div>
    </div>
  `);
}

function signOut() {
  document.getElementById("profileMenu").classList.remove("open");
  if (!confirm("Are you sure you want to sign out? All local data will be cleared.")) return;
  localStorage.clear();
  showToast("👋 Signed out. See you soon!");
  setTimeout(() => location.reload(), 1500);
}

// ============================================================
//  FOOTER MODALS
// ============================================================
function openModal(title, content) {
  const el = document.createElement("div");
  el.className = "info-modal";
  el.innerHTML = `
    <div class="info-modal-box">
      <div class="info-modal-header">
        <h2><i class="fa fa-info-circle"></i> ${escHtml(title)}</h2>
        <button class="close-btn" onclick="this.closest('.info-modal').remove()"><i class="fa fa-times"></i></button>
      </div>
      <div class="info-modal-body">${content}</div>
    </div>`;
  el.addEventListener("click", function (e) { if (e.target === el) el.remove(); });
  document.body.appendChild(el);
}

function showAboutModal() {
  openModal("About MailSoft", `
    <p><strong>MailSoft</strong> is a modern, fast and secure email client built for seamless communication.</p>
    <p><strong>Version:</strong> 2.1.0 &nbsp;|&nbsp; <strong>Created by:</strong> Arpna</p>
    <h3 style="margin-top:14px">Tech Stack</h3>
    <ul>
      <li><i class="fa fa-check"></i> Pure HTML, CSS & JavaScript — no frameworks</li>
      <li><i class="fa fa-check"></i> LocalStorage for full data persistence</li>
      <li><i class="fa fa-check"></i> Dark & Light theme with toggle switch</li>
      <li><i class="fa fa-check"></i> File attachments up to 25 MB</li>
      <li><i class="fa fa-check"></i> Global search across all folders</li>
      <li><i class="fa fa-check"></i> Keyboard shortcuts (Esc, Ctrl+Enter, N)</li>
    </ul>
    <p style="margin-top:12px;color:var(--text-muted);font-size:12px">© 2026 MailSoft. All Rights Reserved.</p>
  `);
}

function showFeatures() {
  switchFolder("inbox");
  setTimeout(() => document.getElementById("infoSection").scrollIntoView({ behavior: "smooth" }), 100);
}

function showContact() {
  openCompose();
  setTimeout(() => {
    document.getElementById("popupTo").value = "support@mailsoft.com";
    document.getElementById("popupSubject").value = "Contact: ";
    document.getElementById("popupSubject").focus();
  }, 80);
}

function showFeedback() {
  openCompose();
  setTimeout(() => {
    document.getElementById("popupTo").value = "feedback@mailsoft.com";
    document.getElementById("popupSubject").value = "Feedback: ";
    document.getElementById("popupSubject").focus();
  }, 80);
}

function showHelpCenter() {
  openModal("Help Center", `
    <h3>Getting Started</h3>
    <p>Use the <strong>Sidebar</strong> to navigate between folders. Click any email to read it.</p>
    <h3>Compose Email</h3>
    <p>Click <strong>Compose</strong> or press <kbd>N</kbd> to write a new email. Press <kbd>Ctrl+Enter</kbd> to send.</p>
    <h3>Search</h3>
    <p>The search bar searches <strong>all folders</strong> — inbox, sent, drafts and trash — at once.</p>
    <h3>Attachments</h3>
    <p>Click the paperclip in the compose window to attach files. Max 5 MB per file, 25 MB total.</p>
    <h3>Keyboard Shortcuts</h3>
    <ul>
      <li><i class="fa fa-keyboard"></i> <kbd>N</kbd> — New compose</li>
      <li><i class="fa fa-keyboard"></i> <kbd>Ctrl+Enter</kbd> — Send email</li>
      <li><i class="fa fa-keyboard"></i> <kbd>Escape</kbd> — Close popup / panel</li>
    </ul>
    <h3>Drafts</h3>
    <p>Drafts auto-save every 30 seconds. Click a draft to resume editing.</p>
    <h3>Trash & Restore</h3>
    <p>Deleted emails go to Trash. Use the restore button to recover them.</p>
  `);
}

function showPrivacyPolicy() {
  openModal("Privacy Policy", `
    <p><strong>Effective Date:</strong> January 2026</p>
    <h3>Data Storage</h3>
    <p>All your email data is stored <strong>locally in your browser</strong> using LocalStorage. Nothing is sent to any server.</p>
    <h3>Third-Party Resources</h3>
    <p>Icons are loaded from Font Awesome CDN and fonts from Google Fonts. These may collect basic usage data per their own policies.</p>
    <h3>Your Rights</h3>
    <p>You can clear all data at any time by signing out or clearing your browser's local storage. No data leaves your device.</p>
  `);
}

function showTerms() {
  openModal("Terms & Conditions", `
    <p>By using MailSoft, you agree to the following:</p>
    <h3>Usage</h3>
    <p>MailSoft is a client-side demonstration application for personal and educational use.</p>
    <h3>Limitations</h3>
    <p>Emails are stored locally only. <strong>No actual emails are sent to real recipients.</strong> No email server is connected.</p>
    <h3>Disclaimer</h3>
    <p>The developers are not responsible for any data loss. Clearing browser data will erase all stored emails.</p>
  `);
}

function showFAQ() {
  openModal("FAQ", `
    <div class="faq-item"><h3>How do I send an email?</h3><p>Click <strong>Compose</strong>, fill in the fields, click <strong>Send</strong> or press <kbd>Ctrl+Enter</kbd>.</p></div>
    <div class="faq-item"><h3>Can I attach files?</h3><p>Yes — click the paperclip in compose. Max 5 MB/file, 25 MB total.</p></div>
    <div class="faq-item"><h3>How do I save a draft?</h3><p>Click <strong>Save Draft</strong>. Drafts also auto-save every 30 seconds.</p></div>
    <div class="faq-item"><h3>Where do deleted emails go?</h3><p>To <strong>Trash</strong>. Restore them with the ↩ icon, or empty trash to permanently delete.</p></div>
    <div class="faq-item"><h3>Does search work across all folders?</h3><p>Yes — the search bar searches inbox, sent, drafts and trash simultaneously.</p></div>
    <div class="faq-item"><h3>Is my data saved between sessions?</h3><p>Yes — everything is stored in browser LocalStorage and persists between page reloads.</p></div>
    <div class="faq-item"><h3>How do I switch themes?</h3><p>Use the toggle switch at the bottom of the sidebar.</p></div>
  `);
}

// ============================================================
//  TOOLBAR / TEMPLATES
// ============================================================
function formatText(cmd) {
  document.getElementById("popupMessage").focus();
  document.execCommand(cmd, false, null);
}

function insertTemplate(type) {
  const el = document.getElementById("popupMessage");
  el.focus();
  const sig = localStorage.getItem("mailsoft-sig") || "Arpna";
  const tpls = {
    greeting: "Dear [Name],\n\nI hope this email finds you well.\n\n",
    closing:  `\n\nThank you for your time.\n\nBest regards,\n${sig}`
  };
  document.execCommand("insertText", false, tpls[type] || "");
  document.getElementById("charCount").textContent = el.innerText.length;
}

// ============================================================
//  THEME
// ============================================================
function loadTheme() {
  const saved = localStorage.getItem("mailsoft-theme") || "dark";
  if (saved === "light") {
    document.body.classList.add("light-mode");
    document.getElementById("themeCheckbox").checked = true;
  }
}

function toggleTheme() {
  const light = document.getElementById("themeCheckbox").checked;
  document.body.classList.toggle("light-mode", light);
  localStorage.setItem("mailsoft-theme", light ? "light" : "dark");
  showToast(light ? "☀️ Light mode on" : "🌙 Dark mode on");
}

// ============================================================
//  HELPERS
// ============================================================
function findEmail(id, folder) {
  if (folder === "starred") {
    return [...emails.inbox, ...emails.sent, ...emails.drafts, ...emails.trash].find(e => e.id === id);
  }
  return (emails[folder] || []).find(e => e.id === id);
}

function escHtml(str) {
  if (typeof str !== "string") return "";
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ============================================================
//  TOAST
// ============================================================
let toastTimer = null;
function showToast(msg, color) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.style.background = color || "var(--accent)";
  t.textContent = msg;
  t.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}
