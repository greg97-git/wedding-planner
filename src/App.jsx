import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase.js";

// ─── Supabase data helpers ────────────────────────────────────────────────────
const TABLE = "wedding_data";
const ROW_KEY = "main";

async function loadState() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("payload")
    .eq("id", ROW_KEY)
    .single();
  if (error || !data) return null;
  return data.payload;
}

async function saveState(state) {
  await supabase
    .from(TABLE)
    .upsert({ id: ROW_KEY, payload: state }, { onConflict: "id" });
}

// ─── Zola CSV merge ───────────────────────────────────────────────────────────
// Correctly handles Zola's quoted, multi-line CSV format
function parseZolaCSV(csvText) {
  const rows = [];
  let cur = "", inQuote = false;
  let currentRow = [];

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];
    if (inQuote) {
      if (ch === '"' && next === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { currentRow.push(cur.trim()); cur = ""; }
      else if (ch === '\n') { currentRow.push(cur.trim()); if (currentRow.some(c => c)) rows.push(currentRow); currentRow = []; cur = ""; }
      else if (ch === '\r') { /* skip */ }
      else { cur += ch; }
    }
  }
  if (cur || currentRow.length) { currentRow.push(cur.trim()); if (currentRow.some(c => c)) rows.push(currentRow); }
  return rows;
}

function zolaRsvp(receptionVal) {
  const v = (receptionVal || "").trim().toLowerCase();
  if (v === "attending") return "Accepted";
  if (v === "declined") return "Declined";
  return "Pending";
}

function mergeZolaCSV(csvText, existingGuests) {
  const rows = parseZolaCSV(csvText);
  if (rows.length < 2) return { guests: existingGuests, added: 0, updated: 0, warnings: [] };

  const headers = rows[0].map(h => h.replace(/"/g, "").trim().toLowerCase());
  const col = (name) => headers.findIndex(h => h.includes(name));

  const iFirst     = col("first name");
  const iLast      = col("last name");
  const iReception = col("reception");
  const iMeal      = col("meal choice");
  const iDiet      = col("dietary");
  const iSong      = col("song");

  const guestMap = new Map();
  existingGuests.forEach(g => {
    guestMap.set(`${g.firstName}__${g.lastName}`.toLowerCase(), g);
  });

  let added = 0, updated = 0;
  const warnings = [];
  const incoming = new Set();
  const updatedGuests = [...existingGuests];

  rows.slice(1).forEach(row => {
    const firstName = iFirst >= 0 ? (row[iFirst] || "").trim() : "";
    const lastName  = iLast  >= 0 ? (row[iLast]  || "").trim() : "";
    if (!firstName && !lastName) return;

    const reception = iReception >= 0 ? (row[iReception] || "") : "";
    const mealRaw   = iMeal      >= 0 ? (row[iMeal] || "").trim() : "";
    const diet      = iDiet      >= 0 ? (row[iDiet] || "").trim() : "";
    const song      = iSong      >= 0 ? (row[iSong] || "").trim() : "";

    const rsvp     = zolaRsvp(reception);
    const mealNorm = ["no response", ""].includes(mealRaw.toLowerCase()) ? "" : mealRaw;
    const guestType = mealNorm.toLowerCase().includes("kids meal") ? "Child" : "Adult";

    const cleanDiet = diet && !["no", "no response"].includes(diet.toLowerCase()) ? diet : "";
    const cleanSong = song && !["no", "no response"].includes(song.toLowerCase()) ? song : "";

    const zolaNoteParts = [];
    if (cleanDiet) zolaNoteParts.push(`🥗 ${cleanDiet}`);
    if (cleanSong) zolaNoteParts.push(`🎵 ${cleanSong}`);
    const zolaNote = zolaNoteParts.join("\n");

    const key = `${firstName}__${lastName}`.toLowerCase();
    incoming.add(key);

    const existing = guestMap.get(key);
    if (existing) {
      const prevRsvp = existing.rsvp;
      existing.firstName   = firstName;
      existing.lastName    = lastName;
      existing.rsvp        = rsvp;
      if (mealNorm) existing.meal = mealNorm;
      existing.guestType   = guestType;
      existing.dietary     = cleanDiet || existing.dietary || "";
      existing.songRequest = cleanSong || existing.songRequest || "";
      if (!existing.notes || existing.notes.startsWith("🥗") || existing.notes.startsWith("🎵")) {
        existing.notes = zolaNote;
      }
      if (prevRsvp === "Accepted" && rsvp === "Declined" && existing.tableId) {
        warnings.push(`${firstName} ${lastName} declined but is still assigned to a table — review seating.`);
      }
      updated++;
    } else {
      const newGuest = {
        id: `g_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        firstName, lastName, email: "",
        rsvp, meal: mealNorm, guestType,
        dietary: cleanDiet, songRequest: cleanSong,
        tags: [], notes: zolaNote,
        tableId: null, roomId: null,
      };
      updatedGuests.push(newGuest);
      guestMap.set(key, newGuest);
      added++;
    }
  });

  existingGuests.forEach(g => {
    const key = `${g.firstName}__${g.lastName}`.toLowerCase();
    if (!incoming.has(key)) {
      warnings.push(`${g.firstName} ${g.lastName} was not found in the new export — not deleted.`);
    }
  });

  return { guests: updatedGuests, added, updated, warnings };
}

// ─── Initial seed data ────────────────────────────────────────────────────────
function seedData() {
  return {
    guests: [
      { id: "g1", firstName: "Marie", lastName: "Tremblay", email: "", rsvp: "Accepted", meal: "stuffed breaded chicken with brie", guestType: "Adult", tags: ["VIP"], dietary: "", songRequest: "", notes: "Bride's aunt", tableId: null, roomId: null },
      { id: "g2", firstName: "Jean", lastName: "Tremblay", email: "", rsvp: "Accepted", meal: "salmon", guestType: "Adult", tags: ["VIP"], dietary: "", songRequest: "", notes: "", tableId: null, roomId: null },
      { id: "g3", firstName: "Sophie", lastName: "Bernard", email: "", rsvp: "Pending", meal: "", guestType: "Adult", tags: [], dietary: "", songRequest: "", notes: "", tableId: null, roomId: null },
      { id: "g4", firstName: "Lucas", lastName: "Martin", email: "", rsvp: "Declined", meal: "", guestType: "Adult", tags: [], dietary: "", songRequest: "", notes: "", tableId: null, roomId: null },
      { id: "g5", firstName: "Emma", lastName: "Côté", email: "", rsvp: "Accepted", meal: "kids meal (12 years and under)", guestType: "Child", tags: ["Lodging"], dietary: "", songRequest: "", notes: "", tableId: null, roomId: null },
    ],
    tables: [
      { id: "t1", name: "Table 1", capacity: 8 },
      { id: "t2", name: "Table 2", capacity: 8 },
    ],
    rooms: [
      { id: "r1", name: "Room 101", roomType: "King + Sofa", capacity: 2, status: "Pending" },
    ],
    vendors: [
      { id: "v1", name: "Studio Lumière", category: "Photography", contact: "Claire Dupont", email: "claire@studiolumiere.ca", phone: "514-555-0101", status: "Confirmed", cost: 4500, notes: "8-hour package, 2 photographers" },
    ],
    todos: [
      { id: "td1", title: "Send save-the-dates", category: "Invitations", dueDate: "2026-02-01", assignee: "Both", priority: "High", done: true },
      { id: "td2", title: "Confirm final headcount with venue", category: "Venue", dueDate: "2026-07-15", assignee: "Greg", priority: "High", done: false },
      { id: "td3", title: "Choose wedding cake flavour", category: "Catering", dueDate: "2026-06-30", assignee: "Sofia", priority: "Medium", done: false },
    ],
    tags: [...DEFAULT_TAGS],
  };
}

// ─── Palette & constants ──────────────────────────────────────────────────────
const RSVP_COLORS = {
  Accepted: "#2d6a4f",
  Declined: "#b94a4a",
  Pending: "#a07c4a",
};
const VENDOR_STATUS = ["Contacted", "Deposit Paid", "Confirmed", "Cancelled"];
const VENDOR_CATS = ["Photography", "Videography", "DJ", "Band", "Florist", "Catering", "Hair & Makeup", "Transportation", "Officiant", "Venue", "Other"];
const MEAL_OPTIONS = ["Chicken", "Fish", "Beef", "Vegetarian", "Vegan", "Kids Meal", ""];
const PRIORITIES = ["High", "Medium", "Low"];
const TODO_CATS = ["Venue", "Catering", "Invitations", "Attire", "Flowers", "Music", "Photography", "Travel", "Lodging", "Legal", "Other"];
const DEFAULT_TAGS = ["VIP", "Lodging", "Bridal Party", "Family", "Out of Town"];
const ROOM_TYPES = ["King + Sofa", "2 Queen"];

// ─── Shared styles (hoisted — used in login screen and components) ──────────────
const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #d4c8be", borderRadius: 6,
  fontFamily: "Georgia, serif", fontSize: 13, color: "#3a2e27", background: "#faf8f5",
  boxSizing: "border-box", outline: "none",
};

// ─── App ──────────────────────────────────────────────────────────────────────
const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD || "wedding2026";

export default function App() {
  const [tab, setTab] = useState("guests");
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  const [showFirstLaunch, setShowFirstLaunch] = useState(false);
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("wp_authed") === "1");
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);
  const fileRef = useRef();
  const jsonRef = useRef();

  useEffect(() => {
    if (!authed) return;
    loadState().then(saved => {
      if (saved) {
        setData(saved);
      } else {
        setShowFirstLaunch(true);
        setData(seedData());
      }
      setLoaded(true);
    });

    // Real-time sync — when Supabase row changes on another device, update local state
    const channel = supabase
      .channel("wedding_data_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "wedding_data" }, (payload) => {
        if (payload.new?.payload) {
          setData(payload.new.payload);
        }
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [authed]);

  const update = useCallback((patch) => {
    setData(prev => {
      const next = { ...prev, ...patch };
      saveState(next);
      return next;
    });
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    if (pwInput === APP_PASSWORD) {
      sessionStorage.setItem("wp_authed", "1");
      setAuthed(true);
      setPwError(false);
    } else {
      setPwError(true);
    }
  };

  // ── Login screen ─────────────────────────────────────────────────────────────
  if (!authed) return (
    <div style={{ minHeight: "100vh", background: "#faf8f5", fontFamily: "Georgia, serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, maxWidth: 380, width: "100%", boxShadow: "0 8px 40px #00000015", textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>💍</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#3a2e27", marginBottom: 4 }}>Greg & Sofia</div>
        <div style={{ fontSize: 12, color: "#9b8b80", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 32 }}>August 14, 2026 · Auberge des Gallant</div>
        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="password"
            placeholder="Enter password"
            value={pwInput}
            onChange={e => { setPwInput(e.target.value); setPwError(false); }}
            style={{ ...inputStyle, textAlign: "center", fontSize: 15, padding: "10px 14px" }}
            autoFocus
          />
          {pwError && <div style={{ color: "#b94a4a", fontSize: 13 }}>Incorrect password.</div>}
          <button type="submit" style={{ background: "#8b5e3c", color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 14, fontWeight: 700, fontFamily: "Georgia, serif", cursor: "pointer" }}>
            Enter
          </button>
        </form>
      </div>
    </div>
  );

  const handleExport = () => {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wedding-planner-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleJSONImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        // Basic validation — must have guests array
        if (!imported.guests || !Array.isArray(imported.guests)) {
          setImportMsg({ type: "error", text: "Invalid file — could not find guest data." });
          setTimeout(() => setImportMsg(null), 6000);
          return;
        }
        setData(imported);
        saveState(imported);
        setShowFirstLaunch(false);
        setImportMsg({ type: "success", text: `✓ Imported ${imported.guests.length} guests, ${imported.todos?.length || 0} tasks, ${imported.vendors?.length || 0} vendors.` });
        setTimeout(() => setImportMsg(null), 6000);
      } catch {
        setImportMsg({ type: "error", text: "Could not read file — make sure it's a valid wedding planner export." });
        setTimeout(() => setImportMsg(null), 6000);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleCSVImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { guests, added, updated, warnings } = mergeZolaCSV(ev.target.result, data.guests);
      update({ guests });
      setImportMsg({ added, updated, warnings });
      setTimeout(() => setImportMsg(null), 8000);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "Georgia, serif", color: "#6b5b4e", fontSize: 18 }}>
      Loading your wedding planner…
    </div>
  );

  // First-launch modal — shown when no saved data is found
  if (showFirstLaunch) return (
    <div style={{ minHeight: "100vh", background: "#faf8f5", fontFamily: "Georgia, serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <input ref={jsonRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleJSONImport} />
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, maxWidth: 460, width: "100%", boxShadow: "0 8px 40px #00000015", textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>💍</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#3a2e27", marginBottom: 6 }}>Greg & Sofia</div>
        <div style={{ fontSize: 12, color: "#9b8b80", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 28 }}>August 14, 2026 · Auberge des Gallant</div>
        <div style={{ fontSize: 15, color: "#6b5b4e", marginBottom: 28, lineHeight: 1.6 }}>
          Welcome! Do you have an existing export to load, or would you like to start fresh?
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Btn onClick={() => jsonRef.current.click()}>Load existing data (import JSON)</Btn>
          <Btn variant="outline" onClick={() => { setShowFirstLaunch(false); saveState(data); }}>Start fresh</Btn>
        </div>
        {importMsg && (
          <div style={{ marginTop: 16, fontSize: 13, color: importMsg.type === "error" ? "#b94a4a" : "#2d6a4f" }}>
            {importMsg.text}
          </div>
        )}
      </div>
    </div>
  );

  const tabs = [
    { id: "guests", label: "Guests" },
    { id: "seating", label: "Seating" },
    { id: "lodging", label: "Lodging" },
    { id: "vendors", label: "Vendors" },
    { id: "todos", label: "To-Do" },
    { id: "tags", label: "Tags" },
  ];

  const accepted = data.guests.filter(g => g.rsvp === "Accepted").length;
  const declined = data.guests.filter(g => g.rsvp === "Declined").length;
  const pending = data.guests.filter(g => g.rsvp === "Pending").length;
  const daysLeft = Math.ceil((new Date("2026-08-14") - new Date()) / 86400000);

  return (
    <div style={{ minHeight: "100vh", background: "#faf8f5", fontFamily: "'Georgia', serif", color: "#3a2e27" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e8e0d8", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.04em", color: "#3a2e27" }}>Greg & Sofia</div>
          <div style={{ fontSize: 12, color: "#9b8b80", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>August 14, 2026 · Auberge des Gallant</div>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <Stat label="Accepted" value={accepted} color="#2d6a4f" />
          <Stat label="Declined" value={declined} color="#b94a4a" />
          <Stat label="Pending" value={pending} color="#a07c4a" />
          <Stat label="Days Left" value={daysLeft} color="#5b7fa6" />
          <div style={{ display: "flex", gap: 8 }}>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleCSVImport} />
            <input ref={jsonRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleJSONImport} />
            <Btn onClick={() => fileRef.current.click()} variant="outline">Import Zola CSV</Btn>
            <Btn onClick={() => jsonRef.current.click()} variant="outline">Import Data</Btn>
            <Btn onClick={handleExport} variant="outline">Export Data</Btn>
          </div>
        </div>
      </div>

      {/* Import result banner */}
      {importMsg && (
        <div style={{ background: importMsg.type === "error" ? "#fdf0f0" : "#f0f7f4", borderBottom: `1px solid ${importMsg.type === "error" ? "#f0b8b8" : "#b7d4c8"}`, padding: "10px 24px", fontSize: 13, color: importMsg.type === "error" ? "#b94a4a" : "#2d6a4f" }}>
          {importMsg.text || `✓ Zola import complete — ${importMsg.added} added, ${importMsg.updated} updated.`}
          {importMsg.warnings && importMsg.warnings.length > 0 && (
            <div style={{ color: "#a07c4a", marginTop: 4 }}>
              {importMsg.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e8e0d8", padding: "0 24px", display: "flex", gap: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "12px 20px", border: "none", background: "none", cursor: "pointer",
            fontFamily: "Georgia, serif", fontSize: 14, fontWeight: tab === t.id ? 700 : 400,
            color: tab === t.id ? "#8b5e3c" : "#9b8b80",
            borderBottom: tab === t.id ? "2px solid #8b5e3c" : "2px solid transparent",
            transition: "all 0.15s",
          }}>{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>
        {tab === "guests" && <GuestsTab data={data} update={update} />}
        {tab === "seating" && <SeatingTab data={data} update={update} />}
        {tab === "lodging" && <LodgingTab data={data} update={update} />}
        {tab === "vendors" && <VendorsTab data={data} update={update} />}
        {tab === "todos" && <TodosTab data={data} update={update} />}
        {tab === "tags" && <TagsTab data={data} update={update} />}
      </div>
    </div>
  );
}

// ─── Guests Tab ───────────────────────────────────────────────────────────────
function GuestsTab({ data, update }) {
  const [filter, setFilter] = useState({ rsvp: "All", tag: "All", search: "" });
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkTag, setBulkTag] = useState("");
  const [bulkMode, setBulkMode] = useState("add"); // "add" | "remove"

  const filtered = data.guests.filter(g => {
    if (filter.rsvp !== "All" && g.rsvp !== filter.rsvp) return false;
    if (filter.tag !== "All" && !g.tags.includes(filter.tag)) return false;
    const q = filter.search.toLowerCase();
    if (q && !`${g.firstName} ${g.lastName}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const allFilteredIds = filtered.map(g => g.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selected.has(id));

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(prev => { const next = new Set(prev); allFilteredIds.forEach(id => next.delete(id)); return next; });
    } else {
      setSelected(prev => { const next = new Set(prev); allFilteredIds.forEach(id => next.add(id)); return next; });
    }
  };

  const applyBulkTag = () => {
    if (!bulkTag || selected.size === 0) return;
    update({
      guests: data.guests.map(g => {
        if (!selected.has(g.id)) return g;
        const tags = bulkMode === "add"
          ? g.tags.includes(bulkTag) ? g.tags : [...g.tags, bulkTag]
          : g.tags.filter(t => t !== bulkTag);
        return { ...g, tags };
      })
    });
    setSelected(new Set());
    setBulkTag("");
  };

  const mealCounts = {};
  data.guests.filter(g => g.rsvp === "Accepted" && g.meal).forEach(g => {
    mealCounts[g.meal] = (mealCounts[g.meal] || 0) + 1;
  });

  const saveGuest = (guest) => {
    const exists = data.guests.find(g => g.id === guest.id);
    if (exists) {
      update({ guests: data.guests.map(g => g.id === guest.id ? guest : g) });
    } else {
      update({ guests: [...data.guests, guest] });
    }
    setEditing(null);
    setShowAdd(false);
  };

  const deleteGuest = (id) => {
    update({ guests: data.guests.filter(g => g.id !== id) });
    setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Search guests…" value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
            style={{ ...inputStyle, width: 180 }} />
          <Select value={filter.rsvp} onChange={v => setFilter(f => ({ ...f, rsvp: v }))}
            options={["All", "Accepted", "Declined", "Pending"]}
            labels={{ All: "All RSVPs" }} />
          <Select value={filter.tag} onChange={v => setFilter(f => ({ ...f, tag: v }))}
            options={["All", ...(data.tags || DEFAULT_TAGS)]}
            labels={{ All: "All Tags" }} />
        </div>
        <Btn onClick={() => setShowAdd(true)}>+ Add Guest</Btn>
      </div>

      {/* Bulk tag bar — appears when guests are selected */}
      {selected.size > 0 && (
        <div style={{ background: "#f0f7f4", border: "1px solid #b7d4c8", borderRadius: 8, padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#2d6a4f" }}>{selected.size} guest{selected.size !== 1 ? "s" : ""} selected</span>
          <Select value={bulkMode} onChange={setBulkMode} options={["add", "remove"]} labels={{ add: "Add tag", remove: "Remove tag" }} />
          <Select value={bulkTag} onChange={setBulkTag} options={["", ...(data.tags || DEFAULT_TAGS)]} labels={{ "": "Choose tag…" }} />
          <Btn onClick={applyBulkTag} variant={bulkMode === "remove" ? "danger" : "primary"}>Apply</Btn>
          <button onClick={() => setSelected(new Set())} style={{ background: "none", border: "none", cursor: "pointer", color: "#9b8b80", fontSize: 13 }}>Clear selection</button>
        </div>
      )}

      {/* Meal summary */}
      {Object.keys(mealCounts).length > 0 && (
        <div style={{ background: "#f5f0ea", borderRadius: 8, padding: "10px 16px", marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
          <span style={{ fontWeight: 600, color: "#6b5b4e" }}>Meal counts (accepted):</span>
          {Object.entries(mealCounts).map(([m, c]) => {
            const short = m.toLowerCase().includes("chicken") ? "Chicken" :
                          m.toLowerCase().includes("salmon") ? "Salmon" :
                          m.toLowerCase().includes("ravioli") || m.toLowerCase().includes("vegetarian") ? "Vegetarian/Vegan" :
                          m.toLowerCase().includes("kids") ? "Kids Meal" :
                          (m.charAt(0).toUpperCase() + m.slice(1));
            return <span key={m} style={{ color: "#3a2e27" }} title={m}>{short}: <strong>{c}</strong></span>;
          })}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e8e0d8" }}>
              <th style={{ padding: "8px 12px", width: 32 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                  style={{ cursor: "pointer", accentColor: "#8b5e3c" }} />
              </th>
              {["Name", "RSVP", "Meal", "Type", "Dietary", "Tags", "Table", "Notes", ""].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#9b8b80", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(g => {
              const table = data.tables.find(t => t.id === g.tableId);
              const isSelected = selected.has(g.id);
              return (
                <tr key={g.id} style={{ borderBottom: "1px solid #f0ebe4", background: isSelected ? "#f0f7f4" : "transparent" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(g.id)}
                      style={{ cursor: "pointer", accentColor: "#8b5e3c" }} />
                  </td>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>{g.firstName} {g.lastName}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ background: RSVP_COLORS[g.rsvp] + "22", color: RSVP_COLORS[g.rsvp], padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>{g.rsvp}</span>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.meal ? g.meal.charAt(0).toUpperCase() + g.meal.slice(1) : "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 13 }}>{g.guestType}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: g.dietary ? "#b94a4a" : "#9b8b80", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.dietary || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {g.tags.map(t => <Tag key={t} label={t} />)}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "#9b8b80" }}>{table?.name || "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#9b8b80", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.notes || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Btn size="sm" variant="outline" onClick={() => setEditing({ ...g })}>Edit</Btn>
                      <Btn size="sm" variant="danger" onClick={() => deleteGuest(g.id)}>✕</Btn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <EmptyState message="No guests match your filters." />}
      </div>

      {(editing || showAdd) && (
        <GuestModal
          guest={editing || { id: `g_${Date.now()}`, firstName: "", lastName: "", email: "", rsvp: "Pending", meal: "", guestType: "Adult", dietary: "", songRequest: "", tags: [], notes: "", tableId: null, roomId: null }}
          onSave={saveGuest}
          onClose={() => { setEditing(null); setShowAdd(false); }}
          tags={data.tags || DEFAULT_TAGS}
        />
      )}
    </div>
  );
}

function GuestModal({ guest, onSave, onClose, tags }) {
  const [g, setG] = useState(guest);
  const set = (k, v) => setG(prev => ({ ...prev, [k]: v }));
  const toggleTag = (tag) => set("tags", g.tags.includes(tag) ? g.tags.filter(t => t !== tag) : [...g.tags, tag]);

  return (
    <Modal title={g.id.startsWith("g_") && !guest.firstName ? "Add Guest" : "Edit Guest"} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="First Name"><input style={inputStyle} value={g.firstName} onChange={e => set("firstName", e.target.value)} /></Field>
        <Field label="Last Name"><input style={inputStyle} value={g.lastName} onChange={e => set("lastName", e.target.value)} /></Field>
        <Field label="RSVP">
          <Select value={g.rsvp} onChange={v => set("rsvp", v)} options={["Pending", "Accepted", "Declined"]} />
        </Field>
        <Field label="Guest Type">
          <Select value={g.guestType} onChange={v => set("guestType", v)} options={["Adult", "Child"]} />
        </Field>
        <Field label="Meal Choice" span={2}>
          <input style={inputStyle} value={g.meal || ""} onChange={e => set("meal", e.target.value)} placeholder="e.g. stuffed breaded chicken with brie" />
        </Field>
        <Field label="Dietary Restrictions" span={2}>
          <textarea style={{ ...inputStyle, height: 52, resize: "vertical" }} value={g.dietary || ""} onChange={e => set("dietary", e.target.value)} placeholder="Allergies, intolerances, preferences…" />
        </Field>
        <Field label="Song Request" span={2}>
          <input style={inputStyle} value={g.songRequest || ""} onChange={e => set("songRequest", e.target.value)} placeholder="Song request from this guest" />
        </Field>
        <Field label="Notes" span={2}>
          <textarea style={{ ...inputStyle, height: 52, resize: "vertical" }} value={g.notes} onChange={e => set("notes", e.target.value)} placeholder="Your private notes about this guest" />
        </Field>
        <Field label="Tags" span={2}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(tags || DEFAULT_TAGS).map(t => (
              <button key={t} onClick={() => toggleTag(t)} style={{
                padding: "4px 12px", borderRadius: 12, border: "1px solid",
                borderColor: g.tags.includes(t) ? "#8b5e3c" : "#d4c8be",
                background: g.tags.includes(t) ? "#8b5e3c" : "transparent",
                color: g.tags.includes(t) ? "#fff" : "#6b5b4e",
                cursor: "pointer", fontSize: 13, fontFamily: "Georgia, serif",
              }}>{t}</button>
            ))}
          </div>
        </Field>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave(g)}>Save Guest</Btn>
      </div>
    </Modal>
  );
}

// ─── Seating Tab ──────────────────────────────────────────────────────────────
function SeatingTab({ data, update }) {
  const [dragGuest, setDragGuest] = useState(null);
  const [showAddTable, setShowAddTable] = useState(false);
  const [newTable, setNewTable] = useState({ name: "", capacity: 8 });

  const acceptedGuests = data.guests.filter(g => g.rsvp === "Accepted");
  const unassigned = acceptedGuests.filter(g => !g.tableId);

  const assignGuest = (guestId, tableId) => {
    update({ guests: data.guests.map(g => g.id === guestId ? { ...g, tableId } : g) });
  };

  const removeFromTable = (guestId) => {
    update({ guests: data.guests.map(g => g.id === guestId ? { ...g, tableId: null } : g) });
  };

  const deleteTable = (tableId) => {
    update({
      tables: data.tables.filter(t => t.id !== tableId),
      guests: data.guests.map(g => g.tableId === tableId ? { ...g, tableId: null } : g),
    });
  };

  const addTable = () => {
    if (!newTable.name) return;
    update({ tables: [...data.tables, { id: `t_${Date.now()}`, name: newTable.name, capacity: Number(newTable.capacity) }] });
    setNewTable({ name: "", capacity: 8 });
    setShowAddTable(false);
  };

  const onDrop = (tableId) => {
    if (dragGuest) { assignGuest(dragGuest, tableId); setDragGuest(null); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#9b8b80" }}>
          Drag accepted guests from the pool to assign them. {unassigned.length} unassigned.
        </div>
        <Btn onClick={() => setShowAddTable(true)}>+ Add Table</Btn>
      </div>

      {/* Unassigned pool */}
      <div style={{ marginBottom: 24 }}>
        <SectionLabel>Unassigned Guests ({unassigned.length})</SectionLabel>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", minHeight: 44, background: "#f5f0ea", borderRadius: 8, padding: 12, border: "2px dashed #d4c8be" }}
          onDragOver={e => e.preventDefault()}
          onDrop={() => { if (dragGuest) { removeFromTable(dragGuest); setDragGuest(null); } }}>
          {unassigned.length === 0
            ? <span style={{ color: "#9b8b80", fontSize: 13, alignSelf: "center" }}>All accepted guests are seated.</span>
            : unassigned.map(g => (
              <GuestChip key={g.id} guest={g} onDragStart={() => setDragGuest(g.id)} />
            ))}
        </div>
      </div>

      {/* Tables */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        {data.tables.map(table => {
          const seated = data.guests.filter(g => g.tableId === table.id);
          const over = seated.length > table.capacity;
          return (
            <div key={table.id} style={{ background: "#fff", borderRadius: 10, border: `2px solid ${over ? "#b94a4a" : "#e8e0d8"}`, padding: 16 }}
              onDragOver={e => e.preventDefault()}
              onDrop={() => onDrop(table.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{table.name}</div>
                  <div style={{ fontSize: 12, color: over ? "#b94a4a" : "#9b8b80" }}>{seated.length}/{table.capacity} seats{over ? " — OVER CAPACITY" : ""}</div>
                </div>
                <button onClick={() => deleteTable(table.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#d4c8be", fontSize: 18 }}>✕</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minHeight: 32 }}>
                {seated.map(g => (
                  <div key={g.id} draggable onDragStart={() => setDragGuest(g.id)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#faf8f5", borderRadius: 6, padding: "4px 8px", fontSize: 13, cursor: "grab" }}>
                    <span>{g.firstName} {g.lastName} {g.tags.includes("VIP") && "⭐"}</span>
                    <button onClick={() => removeFromTable(g.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#d4c8be", fontSize: 14 }}>✕</button>
                  </div>
                ))}
                {seated.length === 0 && <span style={{ color: "#c8bdb4", fontSize: 12 }}>Drop guests here</span>}
              </div>
            </div>
          );
        })}
      </div>

      {showAddTable && (
        <Modal title="Add Table" onClose={() => setShowAddTable(false)}>
          <div style={{ display: "flex", gap: 12, flexDirection: "column" }}>
            <Field label="Table Name"><input style={inputStyle} value={newTable.name} onChange={e => setNewTable(t => ({ ...t, name: e.target.value }))} placeholder="e.g. Head Table" /></Field>
            <Field label="Capacity"><input style={inputStyle} type="number" value={newTable.capacity} min={1} max={30} onChange={e => setNewTable(t => ({ ...t, capacity: e.target.value }))} /></Field>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
            <Btn variant="outline" onClick={() => setShowAddTable(false)}>Cancel</Btn>
            <Btn onClick={addTable}>Add Table</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Lodging Tab ──────────────────────────────────────────────────────────────
function LodgingTab({ data, update }) {
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [newRoom, setNewRoom] = useState({ name: "", roomType: "King + Sofa", capacity: 2, status: "Pending" });
  const [editingRoom, setEditingRoom] = useState(null);

  const saveRoom = (room) => {
    update({ rooms: data.rooms.map(r => r.id === room.id ? room : r) });
    setEditingRoom(null);
  };

  const lodgingGuests = data.guests.filter(g => g.tags.includes("Lodging") && g.rsvp === "Accepted");
  const unassigned = lodgingGuests.filter(g => !g.roomId);

  const assignToRoom = (guestId, roomId) => {
    update({ guests: data.guests.map(g => g.id === guestId ? { ...g, roomId } : g) });
  };

  const removeFromRoom = (guestId) => {
    update({ guests: data.guests.map(g => g.id === guestId ? { ...g, roomId: null } : g) });
  };

  const addRoom = () => {
    if (!newRoom.name) return;
    update({ rooms: [...data.rooms, { id: `r_${Date.now()}`, name: newRoom.name, roomType: newRoom.roomType, capacity: Number(newRoom.capacity), status: newRoom.status || "Pending" }] });
    setNewRoom({ name: "", roomType: "King + Sofa", capacity: 2, status: "Pending" });
    setShowAddRoom(false);
  };

  const deleteRoom = (roomId) => {
    update({
      rooms: data.rooms.filter(r => r.id !== roomId),
      guests: data.guests.map(g => g.roomId === roomId ? { ...g, roomId: null } : g),
    });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#9b8b80" }}>
          Only accepted guests tagged "Lodging" appear here. {unassigned.length} unassigned.
        </div>
        <Btn onClick={() => setShowAddRoom(true)}>+ Add Room</Btn>
      </div>

      {/* Unassigned */}
      <div style={{ marginBottom: 24 }}>
        <SectionLabel>Needs a Room ({unassigned.length})</SectionLabel>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", background: "#f5f0ea", borderRadius: 8, padding: 12, border: "2px dashed #d4c8be", minHeight: 44 }}>
          {unassigned.length === 0
            ? <span style={{ color: "#9b8b80", fontSize: 13 }}>All lodging guests are assigned.</span>
            : unassigned.map(g => <GuestChip key={g.id} guest={g} />)}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        {data.rooms.map(room => {
          const assigned = data.guests.filter(g => g.roomId === room.id);
          const over = assigned.length > room.capacity;
          return (
            <div key={room.id} style={{ background: "#fff", borderRadius: 10, border: `2px solid ${over ? "#b94a4a" : "#e8e0d8"}`, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{room.name}</div>
                  <div style={{ fontSize: 12, color: "#9b8b80", marginTop: 2, display: "flex", gap: 8, alignItems: "center" }}>
                    {room.roomType && (
                      <span style={{ background: "#e8e0d8", color: "#6b5b4e", padding: "1px 7px", borderRadius: 8, fontWeight: 600 }}>{room.roomType}</span>
                    )}
                    <span style={{ background: room.status === "Confirmed" ? "#2d6a4f22" : "#a07c4a22", color: room.status === "Confirmed" ? "#2d6a4f" : "#a07c4a", padding: "1px 7px", borderRadius: 8, fontWeight: 600 }}>{room.status || "Pending"}</span>
                    <span style={{ color: over ? "#b94a4a" : "#9b8b80" }}>{assigned.length}/{room.capacity} guests</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setEditingRoom({ ...room })} style={{ background: "none", border: "none", cursor: "pointer", color: "#9b8b80", fontSize: 15 }} title="Edit room">✎</button>
                  <button onClick={() => deleteRoom(room.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#d4c8be", fontSize: 18 }}>✕</button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {assigned.map(g => (
                  <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#faf8f5", borderRadius: 6, padding: "4px 8px", fontSize: 13 }}>
                    <span>{g.firstName} {g.lastName}</span>
                    <button onClick={() => removeFromRoom(g.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#d4c8be", fontSize: 14 }}>✕</button>
                  </div>
                ))}
              </div>
              {/* Assign dropdown */}
              {unassigned.length > 0 && (
                <select onChange={e => { if (e.target.value) { assignToRoom(e.target.value, room.id); e.target.value = ""; } }}
                  style={{ ...inputStyle, marginTop: 10, fontSize: 12 }} defaultValue="">
                  <option value="">+ Assign guest…</option>
                  {unassigned.map(g => <option key={g.id} value={g.id}>{g.firstName} {g.lastName}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>

      {showAddRoom && (
        <Modal title="Add Room" onClose={() => setShowAddRoom(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Room Name"><input style={inputStyle} value={newRoom.name} onChange={e => setNewRoom(r => ({ ...r, name: e.target.value }))} placeholder="e.g. Room 101" /></Field>
            <Field label="Room Type"><Select value={newRoom.roomType} onChange={v => setNewRoom(r => ({ ...r, roomType: v }))} options={ROOM_TYPES} /></Field>
            <Field label="Capacity"><input style={inputStyle} type="number" value={newRoom.capacity} min={1} onChange={e => setNewRoom(r => ({ ...r, capacity: e.target.value }))} /></Field>
            <Field label="Status"><Select value={newRoom.status || "Pending"} onChange={v => setNewRoom(r => ({ ...r, status: v }))} options={["Pending", "Confirmed"]} /></Field>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
            <Btn variant="outline" onClick={() => setShowAddRoom(false)}>Cancel</Btn>
            <Btn onClick={addRoom}>Add Room</Btn>
          </div>
        </Modal>
      )}

      {editingRoom && (
        <Modal title="Edit Room" onClose={() => setEditingRoom(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Room Name"><input style={inputStyle} value={editingRoom.name} onChange={e => setEditingRoom(r => ({ ...r, name: e.target.value }))} /></Field>
            <Field label="Room Type"><Select value={editingRoom.roomType || "King + Sofa"} onChange={v => setEditingRoom(r => ({ ...r, roomType: v }))} options={ROOM_TYPES} /></Field>
            <Field label="Capacity"><input style={inputStyle} type="number" value={editingRoom.capacity} min={1} onChange={e => setEditingRoom(r => ({ ...r, capacity: Number(e.target.value) }))} /></Field>
            <Field label="Status"><Select value={editingRoom.status || "Pending"} onChange={v => setEditingRoom(r => ({ ...r, status: v }))} options={["Pending", "Confirmed"]} /></Field>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
            <Btn variant="outline" onClick={() => setEditingRoom(null)}>Cancel</Btn>
            <Btn onClick={() => saveRoom(editingRoom)}>Save Room</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Vendors Tab ──────────────────────────────────────────────────────────────
function VendorsTab({ data, update }) {
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const totalCost = data.vendors.filter(v => v.status !== "Cancelled").reduce((s, v) => s + Number(v.cost || 0), 0);
  const confirmed = data.vendors.filter(v => v.status === "Confirmed").length;

  const saveVendor = (v) => {
    const exists = data.vendors.find(x => x.id === v.id);
    if (exists) update({ vendors: data.vendors.map(x => x.id === v.id ? v : x) });
    else update({ vendors: [...data.vendors, v] });
    setEditing(null); setShowAdd(false);
  };

  const deleteVendor = (id) => update({ vendors: data.vendors.filter(v => v.id !== id) });

  const statusColor = { "Contacted": "#a07c4a", "Deposit Paid": "#5b7fa6", "Confirmed": "#2d6a4f", "Cancelled": "#b94a4a" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 20 }}>
          <Stat label="Total Committed" value={`$${totalCost.toLocaleString()}`} color="#3a2e27" />
          <Stat label="Confirmed" value={confirmed} color="#2d6a4f" />
        </div>
        <Btn onClick={() => setShowAdd(true)}>+ Add Vendor</Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {data.vendors.map(v => (
          <div key={v.id} style={{ background: "#fff", borderRadius: 10, border: "1px solid #e8e0d8", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{v.name}</div>
                <div style={{ fontSize: 12, color: "#9b8b80", marginTop: 2 }}>{v.category}</div>
              </div>
              <span style={{ background: statusColor[v.status] + "22", color: statusColor[v.status], padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{v.status}</span>
            </div>
            <div style={{ marginTop: 10, fontSize: 13, color: "#6b5b4e", display: "flex", flexDirection: "column", gap: 4 }}>
              {v.contact && <div>👤 {v.contact}</div>}
              {v.email && <div>✉ {v.email}</div>}
              {v.phone && <div>📞 {v.phone}</div>}
              {v.cost && <div style={{ fontWeight: 600, color: "#3a2e27" }}>💰 ${Number(v.cost).toLocaleString()}</div>}
              {v.notes && <div style={{ color: "#9b8b80", fontStyle: "italic" }}>{v.notes}</div>}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              <Btn size="sm" variant="outline" onClick={() => setEditing({ ...v })}>Edit</Btn>
              <Btn size="sm" variant="danger" onClick={() => deleteVendor(v.id)}>✕</Btn>
            </div>
          </div>
        ))}
        {data.vendors.length === 0 && <EmptyState message="No vendors added yet." />}
      </div>

      {(editing || showAdd) && (
        <VendorModal
          vendor={editing || { id: `v_${Date.now()}`, name: "", category: "Photography", contact: "", email: "", phone: "", status: "Contacted", cost: "", notes: "" }}
          onSave={saveVendor}
          onClose={() => { setEditing(null); setShowAdd(false); }}
        />
      )}
    </div>
  );
}

function VendorModal({ vendor, onSave, onClose }) {
  const [v, setV] = useState(vendor);
  const set = (k, val) => setV(prev => ({ ...prev, [k]: val }));
  return (
    <Modal title={vendor.name ? "Edit Vendor" : "Add Vendor"} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Vendor Name" span={2}><input style={inputStyle} value={v.name} onChange={e => set("name", e.target.value)} /></Field>
        <Field label="Category"><Select value={v.category} onChange={val => set("category", val)} options={VENDOR_CATS} /></Field>
        <Field label="Status"><Select value={v.status} onChange={val => set("status", val)} options={VENDOR_STATUS} /></Field>
        <Field label="Contact Name"><input style={inputStyle} value={v.contact} onChange={e => set("contact", e.target.value)} /></Field>
        <Field label="Cost ($)"><input style={inputStyle} type="number" value={v.cost} onChange={e => set("cost", e.target.value)} /></Field>
        <Field label="Email"><input style={inputStyle} value={v.email} onChange={e => set("email", e.target.value)} /></Field>
        <Field label="Phone"><input style={inputStyle} value={v.phone} onChange={e => set("phone", e.target.value)} /></Field>
        <Field label="Notes" span={2}><textarea style={{ ...inputStyle, height: 60, resize: "vertical" }} value={v.notes} onChange={e => set("notes", e.target.value)} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave(v)}>Save Vendor</Btn>
      </div>
    </Modal>
  );
}

// ─── Todos Tab ────────────────────────────────────────────────────────────────
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function monthKey(dateStr) {
  if (!dateStr) return "no-date";
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  if (key === "no-date") return "No Date";
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

function TodosTab({ data, update }) {
  const [filter, setFilter] = useState({ cat: "All", assignee: "All", done: "Active", month: "All" });
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7);

  const availableMonths = [...new Set(data.todos.map(t => monthKey(t.dueDate)))]
    .sort((a, b) => a === "no-date" ? 1 : b === "no-date" ? -1 : a.localeCompare(b));
  const monthLabels = { All: "All Months", ...Object.fromEntries(availableMonths.map(m => [m, monthLabel(m)])) };

  const filtered = data.todos.filter(t => {
    if (filter.done === "Active" && t.done) return false;
    if (filter.done === "Done" && !t.done) return false;
    if (filter.cat !== "All" && t.category !== filter.cat) return false;
    if (filter.assignee !== "All" && t.assignee !== filter.assignee) return false;
    if (filter.month !== "All" && monthKey(t.dueDate) !== filter.month) return false;
    return true;
  }).sort((a, b) => {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return new Date(a.dueDate) - new Date(b.dueDate);
  });

  const grouped = filtered.reduce((acc, t) => {
    const key = monthKey(t.dueDate);
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});
  const groupKeys = Object.keys(grouped).sort((a, b) => a === "no-date" ? 1 : b === "no-date" ? -1 : a.localeCompare(b));

  const overdue = data.todos.filter(t => !t.done && t.dueDate && new Date(t.dueDate + "T00:00:00") < today).length;
  const upcoming = data.todos.filter(t => !t.done && t.dueDate && new Date(t.dueDate + "T00:00:00") >= today && new Date(t.dueDate + "T00:00:00") <= in7).length;

  const toggle = (id) => update({ todos: data.todos.map(t => t.id === id ? { ...t, done: !t.done } : t) });
  const deleteTodo = (id) => update({ todos: data.todos.filter(t => t.id !== id) });
  const saveTodo = (todo) => {
    const exists = data.todos.find(t => t.id === todo.id);
    if (exists) update({ todos: data.todos.map(t => t.id === todo.id ? todo : t) });
    else update({ todos: [...data.todos, todo] });
    setEditing(null); setShowAdd(false);
  };

  const prioColor = { High: "#b94a4a", Medium: "#a07c4a", Low: "#9b8b80" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {overdue > 0 && <span style={{ background: "#b94a4a22", color: "#b94a4a", padding: "4px 12px", borderRadius: 12, fontSize: 13, fontWeight: 600 }}>⚠ {overdue} overdue</span>}
          {upcoming > 0 && <span style={{ background: "#a07c4a22", color: "#a07c4a", padding: "4px 12px", borderRadius: 12, fontSize: 13, fontWeight: 600 }}>⏰ {upcoming} due this week</span>}
        </div>
        <Btn onClick={() => setShowAdd(true)}>+ Add Task</Btn>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Select value={filter.done} onChange={v => setFilter(f => ({ ...f, done: v }))} options={["Active", "Done", "All"]} labels={{ All: "All Statuses" }} />
        <Select value={filter.month} onChange={v => setFilter(f => ({ ...f, month: v }))} options={["All", ...availableMonths]} labels={monthLabels} />
        <Select value={filter.cat} onChange={v => setFilter(f => ({ ...f, cat: v }))} options={["All", ...TODO_CATS]} labels={{ All: "All Categories" }} />
        <Select value={filter.assignee} onChange={v => setFilter(f => ({ ...f, assignee: v }))} options={["All", "Greg", "Sofia", "Both"]} labels={{ All: "All Assignees" }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {groupKeys.length === 0 && <EmptyState message="No tasks match your filters." />}
        {groupKeys.map(key => (
          <div key={key}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8b5e3c", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid #e8e0d8", display: "flex", alignItems: "center", gap: 8 }}>
              {monthLabel(key)}
              <span style={{ color: "#c8bdb4", fontWeight: 400, fontSize: 11 }}>· {grouped[key].length} task{grouped[key].length !== 1 ? "s" : ""}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {grouped[key].map(t => {
                const due = t.dueDate ? new Date(t.dueDate + "T00:00:00") : null;
                const isOverdue = due && !t.done && due < today;
                const isDueSoon = due && !t.done && due >= today && due <= in7;
                return (
                  <div key={t.id} style={{ background: "#fff", borderRadius: 8, border: `1px solid ${isOverdue ? "#b94a4a44" : "#e8e0d8"}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, opacity: t.done ? 0.6 : 1 }}>
                    <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#8b5e3c" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: t.done ? 400 : 600, textDecoration: t.done ? "line-through" : "none", fontSize: 14 }}>{t.title}</div>
                      <div style={{ fontSize: 12, color: "#9b8b80", marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span>{t.category}</span>
                        <span>·</span>
                        <span>{t.assignee}</span>
                        <span>·</span>
                        <span style={{ color: isOverdue ? "#b94a4a" : isDueSoon ? "#a07c4a" : "#9b8b80", fontWeight: (isOverdue || isDueSoon) ? 600 : 400 }}>
                          {isOverdue ? "⚠ " : isDueSoon ? "⏰ " : ""}{t.dueDate || "No date"}
                        </span>
                      </div>
                    </div>
                    <span style={{ color: prioColor[t.priority], fontSize: 12, fontWeight: 600, minWidth: 45 }}>{t.priority}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Btn size="sm" variant="outline" onClick={() => setEditing({ ...t })}>Edit</Btn>
                      <Btn size="sm" variant="danger" onClick={() => deleteTodo(t.id)}>✕</Btn>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {(editing || showAdd) && (
        <TodoModal
          todo={editing || { id: `td_${Date.now()}`, title: "", category: "Other", dueDate: "", assignee: "Both", priority: "Medium", done: false }}
          onSave={saveTodo}
          onClose={() => { setEditing(null); setShowAdd(false); }}
        />
      )}
    </div>
  );
}

function TodoModal({ todo, onSave, onClose }) {
  const [t, setT] = useState(todo);
  const set = (k, v) => setT(prev => ({ ...prev, [k]: v }));
  return (
    <Modal title={todo.title ? "Edit Task" : "Add Task"} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Task" span={2}><input style={inputStyle} value={t.title} onChange={e => set("title", e.target.value)} placeholder="What needs to be done?" /></Field>
        <Field label="Category"><Select value={t.category} onChange={v => set("category", v)} options={TODO_CATS} /></Field>
        <Field label="Due Date"><input style={inputStyle} type="date" value={t.dueDate} onChange={e => set("dueDate", e.target.value)} /></Field>
        <Field label="Assigned To"><Select value={t.assignee} onChange={v => set("assignee", v)} options={["Greg", "Sofia", "Both"]} /></Field>
        <Field label="Priority"><Select value={t.priority} onChange={v => set("priority", v)} options={PRIORITIES} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave(t)}>Save Task</Btn>
      </div>
    </Modal>
  );
}


// ─── Tags Tab ─────────────────────────────────────────────────────────────────
function TagsTab({ data, update }) {
  const tags = data.tags || DEFAULT_TAGS;
  const [newTag, setNewTag] = useState("");
  const [editingTag, setEditingTag] = useState(null); // { index, value }

  const addTag = () => {
    const trimmed = newTag.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    update({ tags: [...tags, trimmed] });
    setNewTag("");
  };

  const deleteTag = (tag) => {
    // Remove tag from all guests too
    update({
      tags: tags.filter(t => t !== tag),
      guests: data.guests.map(g => ({ ...g, tags: g.tags.filter(t => t !== tag) })),
    });
  };

  const saveEditTag = () => {
    if (!editingTag) return;
    const trimmed = editingTag.value.trim();
    if (!trimmed) return;
    const oldTag = tags[editingTag.index];
    const newTags = tags.map((t, i) => i === editingTag.index ? trimmed : t);
    update({
      tags: newTags,
      guests: data.guests.map(g => ({
        ...g,
        tags: g.tags.map(t => t === oldTag ? trimmed : t),
      })),
    });
    setEditingTag(null);
  };

  const tagUsage = (tag) => data.guests.filter(g => g.tags.includes(tag)).length;

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ fontSize: 13, color: "#9b8b80", marginBottom: 20 }}>
        Tags are shared across Guests and Lodging. Renaming or deleting a tag updates all guests automatically.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {tags.map((tag, i) => (
          <div key={tag} style={{ background: "#fff", border: "1px solid #e8e0d8", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            {editingTag?.index === i ? (
              <>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  value={editingTag.value}
                  onChange={e => setEditingTag(et => ({ ...et, value: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") saveEditTag(); if (e.key === "Escape") setEditingTag(null); }}
                  autoFocus
                />
                <Btn size="sm" onClick={saveEditTag}>Save</Btn>
                <Btn size="sm" variant="outline" onClick={() => setEditingTag(null)}>Cancel</Btn>
              </>
            ) : (
              <>
                <Tag label={tag} />
                <span style={{ fontSize: 12, color: "#9b8b80", flex: 1 }}>{tagUsage(tag)} guest{tagUsage(tag) !== 1 ? "s" : ""}</span>
                <Btn size="sm" variant="outline" onClick={() => setEditingTag({ index: i, value: tag })}>Rename</Btn>
                <Btn size="sm" variant="danger" onClick={() => deleteTag(tag)}>Delete</Btn>
              </>
            )}
          </div>
        ))}
      </div>

      <SectionLabel>Add New Tag</SectionLabel>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{ ...inputStyle, flex: 1 }}
          value={newTag}
          onChange={e => setNewTag(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addTag()}
          placeholder="e.g. Plus One, Shuttle Needed…"
        />
        <Btn onClick={addTag}>Add Tag</Btn>
      </div>
      {tags.includes(newTag.trim()) && newTag.trim() && (
        <div style={{ fontSize: 12, color: "#b94a4a", marginTop: 6 }}>That tag already exists.</div>
      )}
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────
function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#9b8b80", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Tag({ label }) {
  const colors = { VIP: "#8b5e3c", Lodging: "#5b7fa6", "Bridal Party": "#7a4f7a", Family: "#2d6a4f", "Out of Town": "#a07c4a" };
  const c = colors[label] || "#9b8b80";
  return <span style={{ background: c + "22", color: c, padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{label}</span>;
}

function GuestChip({ guest, onDragStart }) {
  return (
    <div draggable={!!onDragStart} onDragStart={onDragStart}
      style={{ background: "#fff", border: "1px solid #e8e0d8", borderRadius: 8, padding: "4px 10px", fontSize: 13, cursor: onDragStart ? "grab" : "default", display: "flex", alignItems: "center", gap: 6 }}>
      {guest.tags.includes("VIP") && <span>⭐</span>}
      {guest.firstName} {guest.lastName}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", size = "md" }) {
  const base = { border: "none", cursor: "pointer", borderRadius: 6, fontFamily: "Georgia, serif", fontWeight: 600, transition: "opacity 0.15s" };
  const sizes = { md: { padding: "8px 16px", fontSize: 13 }, sm: { padding: "4px 10px", fontSize: 12 } };
  const variants = {
    primary: { background: "#8b5e3c", color: "#fff" },
    outline: { background: "transparent", color: "#8b5e3c", border: "1px solid #8b5e3c" },
    danger: { background: "transparent", color: "#b94a4a", border: "1px solid #e8e0d8" },
  };
  return <button onClick={onClick} style={{ ...base, ...sizes[size], ...variants[variant] }}>{children}</button>;
}

function Select({ value, onChange, options, labels }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
      {options.map(o => <option key={o} value={o}>{labels?.[o] ?? o || "— None —"}</option>)}
    </select>
  );
}

function Field({ label, children, span }) {
  return (
    <div style={{ gridColumn: span === 2 ? "1 / -1" : undefined }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#9b8b80", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000055", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px #00000033" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#9b8b80" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: "#9b8b80", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{children}</div>;
}

function EmptyState({ message }) {
  return <div style={{ padding: "40px 0", textAlign: "center", color: "#9b8b80", fontSize: 14, fontStyle: "italic" }}>{message}</div>;
}


