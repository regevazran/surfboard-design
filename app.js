(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    newBtn: $("newBtn"), myProjectsBtn: $("myProjectsBtn"), ownerAuthBtn: $("ownerAuthBtn"), importProjectBtn: $("importProjectBtn"), exportProjectBtn: $("exportProjectBtn"),
    saveCloudBtn: $("saveCloudBtn"), shareEditBtn: $("shareEditBtn"),
    uploadBtn: $("uploadBtn"), emptyUploadBtn: $("emptyUploadBtn"), saveAsCopyBtn: $("saveAsCopyBtn"),
    imageInput: $("imageInput"), projectInput: $("projectInput"), projectName: $("projectName"),
    projectSubtitle: $("projectSubtitle"), cloudDot: $("cloudDot"), cloudStatus: $("cloudStatus"),
    addRegionBtn: $("addRegionBtn"), regionList: $("regionList"), regionsEmpty: $("regionsEmpty"),
    regionEditor: $("regionEditor"), deleteRegionBtn: $("deleteRegionBtn"), duplicateRegionBtn: $("duplicateRegionBtn"), clearMaskBtn: $("clearMaskBtn"),
    regionName: $("regionName"), regionColor: $("regionColor"), regionHex: $("regionHex"), eyedropperBtn: $("eyedropperBtn"),
    intensityRange: $("intensityRange"), intensityOut: $("intensityOut"), featherRange: $("featherRange"), featherOut: $("featherOut"),
    regionVisible: $("regionVisible"), maskPreview: $("maskPreview"),
    editTools: $("editTools"), finishPolygonBtn: $("finishPolygonBtn"), undoBtn: $("undoBtn"), redoBtn: $("redoBtn"),
    brushSize: $("brushSize"), brushSizeOut: $("brushSizeOut"), wandTolerance: $("wandTolerance"), wandToleranceOut: $("wandToleranceOut"),
    zoomOutBtn: $("zoomOutBtn"), zoomInBtn: $("zoomInBtn"), zoomResetBtn: $("zoomResetBtn"), fitBtn: $("fitBtn"),
    canvasViewport: $("canvasViewport"), canvasStage: $("canvasStage"), renderCanvas: $("renderCanvas"), overlayCanvas: $("overlayCanvas"), emptyState: $("emptyState"), uploadDrop: $("uploadDrop"),
    addVariantBtn: $("addVariantBtn"), compareBtn: $("compareBtn"), exportPngBtn: $("exportPngBtn"), compareDialog: $("compareDialog"), compareGrid: $("compareGrid"), clearVariantsBtn: $("clearVariantsBtn"),
    shareDialog: $("shareDialog"), shareDialogText: $("shareDialogText"), shareUrl: $("shareUrl"), copyShareBtn: $("copyShareBtn"), nativeShareBtn: $("nativeShareBtn"),
    projectsDialog: $("projectsDialog"), projectLibraryList: $("projectLibraryList"), projectLibraryEmpty: $("projectLibraryEmpty"), refreshProjectsBtn: $("refreshProjectsBtn"),
    authDialog: $("authDialog"), authEmail: $("authEmail"), authPassword: $("authPassword"), authLoginBtn: $("authLoginBtn"), authMessage: $("authMessage"),
    toast: $("toast")
  };

  const renderCtx = els.renderCanvas.getContext("2d", { willReadFrequently: true });
  const overlayCtx = els.overlayCanvas.getContext("2d");
  const MAX_IMAGE_SIDE = 1800;
  const HISTORY_LIMIT = 24;
  const LEGACY_PROJECT_LIBRARY_KEY = "surfboardColorStudio.projectLibrary.v1";

  const state = {
    imageDataUrl: null,
    sourceImage: null,
    sourcePixels: null,
    width: 0,
    height: 0,
    regions: [],
    selectedRegionId: null,
    tool: "pan",
    brushSize: 48,
    wandTolerance: 35,
    polygonPoints: [],
    drawing: false,
    panning: false,
    lastPoint: null,
    panStart: null,
    panX: 0,
    panY: 0,
    zoom: 1,
    fitScale: 1,
    history: [],
    historyIndex: -1,
    dirty: false,
    rendering: false,
    renderQueued: false,
    variants: [],
    projectId: null,
    editToken: null,
    access: "local", // local | owner | shared
    cloudImageDataUrl: null,
    supabase: null,
    user: null,
    authReady: false,
    ownerProjects: [],
    pendingOwnerProjectId: null,
    openProjectsAfterLogin: false
  };

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function selectedRegion() { return state.regions.find(r => r.id === state.selectedRegionId) || null; }

  function showToast(message, isError = false) {
    els.toast.textContent = message;
    els.toast.classList.toggle("error", isError);
    els.toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.remove("show"), 2800);
  }

  function setCloudStatus(text, type = "") {
    els.cloudStatus.textContent = text;
    els.cloudDot.className = `status-dot${type ? ` ${type}` : ""}`;
  }

  function formatProjectDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    try { return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(d); }
    catch { return d.toLocaleString(); }
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
  }

  function baseUrl(){ return `${location.origin}${location.pathname}`; }
  function ownerUrl(id){ return `${baseUrl()}?p=${encodeURIComponent(id)}`; }
  function buildUrl(id, token){ return `${baseUrl()}?p=${encodeURIComponent(id)}&mode=edit#t=${encodeURIComponent(token)}`; }

  function hasSharedTokenInUrl() {
    const p = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    return !!(p.get("p") && hash.get("t"));
  }

  function updateAuthUi() {
    if (!els.ownerAuthBtn || !els.myProjectsBtn) return;
    els.ownerAuthBtn.textContent = state.user ? "התנתקות" : "כניסה";
    els.ownerAuthBtn.title = state.user?.email || "כניסה לחשבון הבעלים";
    els.myProjectsBtn.hidden = !state.user;
    updateAccessUi();
  }

  function showAuthDialog(message = "") {
    if (!state.supabase) {
      showToast("Supabase אינו מוגדר", true);
      return;
    }
    els.authMessage.textContent = message;
    els.authPassword.value = "";
    if (!els.authDialog.open) els.authDialog.showModal();
    setTimeout(() => (els.authEmail.value ? els.authPassword : els.authEmail).focus(), 0);
  }

  async function refreshAuthUser() {
    if (!state.supabase) return null;
    try {
      const { data, error } = await state.supabase.auth.getUser();
      if (error && !/session missing|auth session missing/i.test(String(error.message || ""))) console.warn(error);
      state.user = data?.user || null;
    } catch (e) {
      console.warn("Could not read auth user", e);
      state.user = null;
    }
    state.authReady = true;
    updateAuthUi();
    return state.user;
  }

  async function signInOwner() {
    const email = (els.authEmail.value || "").trim();
    const password = els.authPassword.value || "";
    if (!email || !password) {
      els.authMessage.textContent = "יש להזין אימייל וסיסמה.";
      return;
    }
    els.authLoginBtn.disabled = true;
    els.authMessage.textContent = "מתחבר…";
    try {
      const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      state.user = data.user || data.session?.user || null;
      state.authReady = true;
      updateAuthUi();
      els.authDialog.close();
      await migrateLegacyEditTokens();
      if (state.pendingOwnerProjectId) {
        const id = state.pendingOwnerProjectId;
        state.pendingOwnerProjectId = null;
        await openOwnerProject(id, { updateUrl: false });
      } else if (state.openProjectsAfterLogin || !state.sourceImage) {
        state.openProjectsAfterLogin = false;
        await showProjectLibrary();
      }
    } catch (e) {
      console.error(e);
      els.authMessage.textContent = "הכניסה נכשלה. בדוק את האימייל והסיסמה.";
    } finally {
      els.authLoginBtn.disabled = false;
    }
  }

  async function signOutOwner() {
    if (!state.supabase || !state.user) return;
    if (state.access === "owner" && state.dirty && !confirm("יש שינויים שלא נשמרו. להתנתק בכל זאת?")) return;
    const { error } = await state.supabase.auth.signOut();
    if (error) { showToast(`שגיאת התנתקות: ${error.message}`, true); return; }
    state.user = null;
    if (state.access === "owner") {
      state.projectId = null;
      state.editToken = null;
      state.access = "local";
      history.replaceState(null, "", baseUrl());
    }
    updateAuthUi();
    setCloudStatus("ענן מוכן — נדרשת כניסה לפרויקטים שלך", "warn");
  }

  async function migrateLegacyEditTokens() {
    if (!state.supabase || !state.user) return;
    let entries = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_PROJECT_LIBRARY_KEY) || "[]");
      if (Array.isArray(parsed)) entries = parsed.filter(x => x?.id && x?.token && x?.access === "edit");
    } catch { return; }
    for (const entry of entries.slice(0, 50)) {
      try {
        await state.supabase.rpc("adopt_owned_surfboard_edit_token", { p_id: entry.id, p_edit_token: entry.token });
      } catch { /* best-effort migration only */ }
    }
  }

  async function fetchOwnerProjects() {
    if (!state.user) throw new Error("Authentication required");
    const { data, error } = await state.supabase.rpc("list_owned_surfboard_projects");
    if (error) throw error;
    state.ownerProjects = Array.isArray(data) ? data : [];
    return state.ownerProjects;
  }

  async function renderProjectLibrary() {
    if (!els.projectLibraryList) return;
    els.projectLibraryList.innerHTML = '<p class="empty-note">טוען פרויקטים מהענן…</p>';
    els.projectLibraryEmpty.hidden = true;
    try {
      const items = await fetchOwnerProjects();
      els.projectLibraryList.innerHTML = "";
      els.projectLibraryEmpty.hidden = items.length > 0;
      if (!items.length) return;

      items.forEach(entry => {
        const row = document.createElement("div");
        row.className = `project-library-item${entry.id === state.projectId ? " active" : ""}`;
        const time = formatProjectDate(entry.updated_at || entry.created_at);
        row.innerHTML = `
          <div class="project-library-main">
            <strong>${escapeHtml(entry.name || "פרויקט גלשן")}</strong>
            <div class="project-library-meta">
              ${time ? `<span>עודכן: ${escapeHtml(time)}</span>` : ""}
              ${entry.id === state.projectId ? "<span>פתוח כעת</span>" : ""}
            </div>
          </div>
          <div class="project-library-actions">
            <button class="btn small primary" type="button" data-action="open">פתח</button>
            <button class="btn small" type="button" data-action="share">העתק קישור עריכה</button>
            <button class="btn small danger-outline" type="button" data-action="delete">מחק</button>
          </div>`;
        row.querySelector('[data-action="open"]').addEventListener("click", async () => {
          if (state.dirty && !confirm("יש שינויים שלא נשמרו בפרויקט הנוכחי. לפתוח פרויקט אחר בכל זאת?")) return;
          els.projectsDialog.close();
          await openOwnerProject(entry.id);
        });
        row.querySelector('[data-action="share"]').addEventListener("click", async () => {
          try {
            const url = await getOwnerShareUrl(entry.id);
            await copyText(url);
            showToast("קישור העריכה הועתק");
          } catch (e) { console.error(e); showToast(cloudErrorMessage(e), true); }
        });
        row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
          if (!confirm(`למחוק את "${entry.name || "הפרויקט"}" מהענן? פעולה זו אינה ניתנת לביטול.`)) return;
          try {
            const { data, error } = await state.supabase.rpc("delete_owned_surfboard_project", { p_id: entry.id });
            if (error) throw error;
            if (data !== true) throw new Error("Delete rejected");
            if (entry.id === state.projectId) {
              state.dirty = false;
              resetApp();
            }
            await renderProjectLibrary();
            showToast("הפרויקט נמחק מהענן");
          } catch (e) { console.error(e); showToast(cloudErrorMessage(e), true); }
        });
        els.projectLibraryList.appendChild(row);
      });
    } catch (e) {
      console.error(e);
      els.projectLibraryList.innerHTML = "";
      els.projectLibraryEmpty.hidden = false;
      els.projectLibraryEmpty.textContent = "לא ניתן לטעון את רשימת הפרויקטים.";
      showToast(cloudErrorMessage(e), true);
    }
  }

  async function showProjectLibrary() {
    if (!state.user) {
      state.openProjectsAfterLogin = true;
      showAuthDialog("כדי לראות את כל הפרויקטים שלך יש להתחבר לחשבון הבעלים.");
      return;
    }
    els.projectLibraryEmpty.textContent = "עדיין אין פרויקטים שמורים בחשבון.";
    if (!els.projectsDialog.open) els.projectsDialog.showModal();
    await renderProjectLibrary();
  }

  async function openOwnerProject(id, { updateUrl = true } = {}) {
    if (!state.user) {
      state.pendingOwnerProjectId = id;
      showAuthDialog("יש להתחבר כדי לפתוח את הפרויקט הזה כבעלים.");
      return;
    }
    setCloudStatus("טוען מהענן…", "warn");
    const { data, error } = await state.supabase.rpc("get_owned_surfboard_project", { p_id: id });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Project not found or not owned by this user");
    state.projectId = id;
    state.editToken = null;
    state.access = "owner";
    await restoreProject(row.project_data, row.image_data, { keepCloud: true });
    state.projectId = id;
    state.access = "owner";
    state.editToken = null;
    setDirty(false);
    setCloudStatus("שמור בענן", "ok");
    updateAccessUi();
    if (updateUrl) history.replaceState(null, "", ownerUrl(id));
    showToast("הפרויקט נטען מהענן");
  }

  async function getOwnerShareUrl(id = state.projectId) {
    if (!state.user) throw new Error("Authentication required");
    const { data, error } = await state.supabase.rpc("get_owned_surfboard_edit_token", { p_id: id });
    if (error) throw error;
    const token = typeof data === "string" ? data : (Array.isArray(data) ? data[0] : data);
    if (!token) throw new Error("Edit token was not returned");
    if (id === state.projectId) state.editToken = token;
    return buildUrl(id, token);
  }

  function initSupabase() {
    const cfg = window.SURFBOARD_APP_CONFIG || {};
    const browserKey = cfg.supabaseKey || cfg.supabaseAnonKey || "";
    if (cfg.supabaseUrl && browserKey && window.supabase?.createClient) {
      state.supabase = window.supabase.createClient(cfg.supabaseUrl, browserKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      setCloudStatus("ענן מוכן", "ok");
      state.supabase.auth.onAuthStateChange((_event, session) => {
        state.user = session?.user || null;
        state.authReady = true;
        updateAuthUi();
      });
    } else {
      setCloudStatus("מצב מקומי — הגדר Supabase לשיתוף", "warn");
    }
  }

  function currentProjectName() {
    return (els.projectName.value || "\u05d2\u05dc\u05e9\u05df \u05d7\u05d3\u05e9").trim() || "\u05d2\u05dc\u05e9\u05df \u05d7\u05d3\u05e9";
  }

  function updateAccessUi() {
    const cloudReady = !!state.supabase;
    const hasImage = !!state.sourceImage;
    const canCreateCloud = !!state.user;
    const canSaveExisting = !!state.projectId && (state.access === "owner" || (state.access === "shared" && !!state.editToken));
    const canSave = canSaveExisting || (!state.projectId && canCreateCloud);

    els.saveCloudBtn.disabled = !cloudReady || !hasImage || !canSave;
    els.shareEditBtn.disabled = !cloudReady || !hasImage || (!state.projectId && !state.user);
    els.saveAsCopyBtn.disabled = !cloudReady || !hasImage || !state.user;
    els.exportPngBtn.disabled = !hasImage;
    els.addVariantBtn.disabled = !hasImage;
    els.compareBtn.disabled = state.variants.length === 0;
    els.exportProjectBtn.disabled = !hasImage;

    if (state.projectId && state.access === "owner") {
      els.projectSubtitle.textContent = "פרויקט ענן — בעלים";
    } else if (state.projectId && state.access === "shared") {
      els.projectSubtitle.textContent = "פרויקט משותף — הרשאת עריכה";
    } else {
      els.projectSubtitle.textContent = "פרויקט מקומי";
    }
    renderRegionEditor();
  }

  function setDirty(v = true) {
    state.dirty = v;
    if (state.projectId && (state.access === "owner" || state.access === "shared")) {
      setCloudStatus(v ? "שינויים שלא נשמרו" : "שמור בענן", v ? "warn" : "ok");
    }
  }

  function createMaskCanvas() {
    const c = document.createElement("canvas");
    c.width = state.width;
    c.height = state.height;
    return c;
  }

  function newRegion(name = `\u05d0\u05d6\u05d5\u05e8 ${state.regions.length + 1}`, color = "#A9D6E5") {
    if (!state.sourceImage) { showToast("\u05d9\u05e9 \u05dc\u05d4\u05e2\u05dc\u05d5\u05ea \u05ea\u05de\u05d5\u05e0\u05d4 \u05dc\u05e4\u05e0\u05d9 \u05d9\u05e6\u05d9\u05e8\u05ea \u05d0\u05d6\u05d5\u05e8", true); return null; }
    const maskCanvas = createMaskCanvas();
    const region = {
      id: uuid(), name, color: color.toUpperCase(), visible: true, intensity: 1, feather: 0,
      maskCanvas, maskCtx: maskCanvas.getContext("2d", { willReadFrequently: true }), avgLightness: null, maskCache: null
    };
    state.regions.push(region);
    state.selectedRegionId = region.id;
    renderRegionList();
    renderRegionEditor();
    setDirty(true);
    commitHistory();
    updateOverlay();
    return region;
  }

  function renderRegionList() {
    els.regionList.innerHTML = "";
    els.regionsEmpty.hidden = state.regions.length > 0;
    state.regions.forEach((r) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `region-item${r.id === state.selectedRegionId ? " active" : ""}`;
      item.innerHTML = `
        <span class="swatch" style="background:${escapeHtml(r.color)}"></span>
        <span class="region-title"><strong>${escapeHtml(r.name)}</strong><span>${r.visible ? "\u05e4\u05e2\u05d9\u05dc" : "\u05de\u05d5\u05e1\u05ea\u05e8"}</span></span>
        <span class="eye" aria-label="${r.visible ? "\u05d4\u05e1\u05ea\u05e8" : "\u05d4\u05e6\u05d2"}">${r.visible ? "\u25c9" : "\u25cb"}</span>`;
      item.addEventListener("click", (e) => {
        const eye = e.target.closest(".eye");
        if (eye) {
          e.stopPropagation();
          r.visible = !r.visible;
          setDirty(true); commitHistory(); renderRegionList(); requestRender();
          return;
        }
        state.selectedRegionId = r.id;
        state.polygonPoints = [];
        renderRegionList(); renderRegionEditor(); updateOverlay();
      });
      els.regionList.appendChild(item);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[ch]);
  }

  function renderRegionEditor() {
    const r = selectedRegion();
    els.regionEditor.classList.toggle("disabled", !r);
    if (!r) return;
    els.regionName.value = r.name;
    els.regionColor.value = r.color;
    els.regionHex.value = r.color.toUpperCase();
    els.intensityRange.value = Math.round(r.intensity * 100);
    els.intensityOut.textContent = `${Math.round(r.intensity * 100)}%`;
    els.featherRange.value = r.feather || 0;
    els.featherOut.textContent = `${r.feather || 0} px`;
    els.regionVisible.checked = !!r.visible;
    els.regionName.disabled = false;
    els.featherRange.disabled = false;
    els.deleteRegionBtn.disabled = false;
    els.duplicateRegionBtn.disabled = false;
    els.clearMaskBtn.disabled = false;
  }

  async function loadImageFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast("\u05d4\u05e7\u05d5\u05d1\u05e5 \u05d0\u05d9\u05e0\u05d5 \u05ea\u05de\u05d5\u05e0\u05d4 \u05e0\u05ea\u05de\u05db\u05ea", true); return; }
    const rawUrl = await fileToDataUrl(file);
    const compressed = await normalizeImageDataUrl(rawUrl, MAX_IMAGE_SIDE, 0.94);
    await loadImageDataUrl(compressed, { resetProject: true });
    els.projectName.value = file.name.replace(/\.[^.]+$/, "") || "\u05d2\u05dc\u05e9\u05df \u05d7\u05d3\u05e9";
    setDirty(true);
    showToast("\u05d4\u05ea\u05de\u05d5\u05e0\u05d4 \u05e0\u05d8\u05e2\u05e0\u05d4. \u05db\u05e2\u05ea \u05d4\u05d5\u05e1\u05e3 \u05d0\u05d6\u05d5\u05e8\u05d9\u05dd \u05d5\u05e1\u05de\u05df \u05d0\u05d5\u05ea\u05dd.");
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  async function normalizeImageDataUrl(dataUrl, maxSide = MAX_IMAGE_SIDE, quality = 0.94) {
    const img = await loadHtmlImage(dataUrl);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
    const hasAlpha = dataUrl.startsWith("data:image/png") || dataUrl.startsWith("data:image/webp");
    return c.toDataURL(hasAlpha ? "image/png" : "image/jpeg", quality);
  }

  function loadHtmlImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function loadImageDataUrl(dataUrl, { resetProject = false } = {}) {
    const img = await loadHtmlImage(dataUrl);
    state.imageDataUrl = dataUrl;
    state.cloudImageDataUrl = dataUrl;
    state.sourceImage = img;
    state.width = img.naturalWidth;
    state.height = img.naturalHeight;
    els.renderCanvas.width = state.width; els.renderCanvas.height = state.height;
    els.overlayCanvas.width = state.width; els.overlayCanvas.height = state.height;
    renderCtx.clearRect(0,0,state.width,state.height);
    renderCtx.drawImage(img, 0, 0, state.width, state.height);
    state.sourcePixels = renderCtx.getImageData(0,0,state.width,state.height);
    if (resetProject) {
      state.regions = [];
      state.selectedRegionId = null;
      state.projectId = null; state.editToken = null; state.access = "local";
      state.history = []; state.historyIndex = -1; state.variants = [];
    }
    state.panX = 0; state.panY = 0; state.zoom = 1; state.polygonPoints = [];
    els.emptyState.hidden = true; els.canvasStage.hidden = false;
    fitStage();
    await requestRender(true);
    renderRegionList(); renderRegionEditor(); updateAccessUi();
    commitHistory();
  }

  function fitStage() {
    if (!state.sourceImage) return;
    const rect = els.canvasViewport.getBoundingClientRect();
    const pad = 28;
    const sx = Math.max(0.05, (rect.width - pad * 2) / state.width);
    const sy = Math.max(0.05, (rect.height - pad * 2) / state.height);
    state.fitScale = Math.min(sx, sy, 1);
    const cssW = state.width * state.fitScale;
    const cssH = state.height * state.fitScale;
    els.canvasStage.style.width = `${cssW}px`;
    els.canvasStage.style.height = `${cssH}px`;
    state.zoom = 1; state.panX = 0; state.panY = 0;
    applyStageTransform();
  }

  function applyStageTransform() {
    els.canvasStage.style.transform = `translate(calc(-50% + ${state.panX}px), calc(-50% + ${state.panY}px)) scale(${state.zoom})`;
    els.zoomResetBtn.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function setZoom(z) {
    state.zoom = clamp(z, 0.25, 6);
    applyStageTransform();
  }

  function canvasPoint(e) {
    const rect = els.overlayCanvas.getBoundingClientRect();
    return {
      x: clamp((e.clientX - rect.left) * state.width / rect.width, 0, state.width),
      y: clamp((e.clientY - rect.top) * state.height / rect.height, 0, state.height)
    };
  }

  function setTool(tool) {
    state.tool = tool;
    state.polygonPoints = tool === "polygon" ? state.polygonPoints : [];
    document.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === tool));
    els.finishPolygonBtn.disabled = !(tool === "polygon" && state.polygonPoints.length >= 3);
    els.overlayCanvas.style.cursor = ({pan:"grab",brush:"crosshair",eraser:"crosshair",polygon:"crosshair",wand:"cell",eyedropper:"copy"})[tool] || "default";
    updateOverlay();
  }

  function invalidateMask(region) {
    region.avgLightness = null;
    region.maskCache = null;
  }

  function averageLightness(region, maskData) {
    if (region.avgLightness != null) return region.avgLightness;
    const src = state.sourcePixels.data;
    let sum = 0, weight = 0;
    for (let i=0; i<src.length; i+=4) {
      const a = maskData[i+3] / 255;
      if (a < 0.02) continue;
      const max = Math.max(src[i],src[i+1],src[i+2]);
      const min = Math.min(src[i],src[i+1],src[i+2]);
      sum += ((max + min) / 510) * a;
      weight += a;
    }
    region.avgLightness = weight ? sum / weight : 0.5;
    return region.avgLightness;
  }

  function getMaskPixels(region) {
    const feather = Number(region.feather) || 0;
    if (region.maskCache && region.maskCache.feather === feather) return region.maskCache.data;
    let data;
    if (feather <= 0) {
      data = region.maskCtx.getImageData(0,0,state.width,state.height).data;
    } else {
      const temp = document.createElement("canvas"); temp.width = state.width; temp.height = state.height;
      const tctx = temp.getContext("2d", { willReadFrequently: true });
      tctx.filter = `blur(${feather}px)`;
      tctx.drawImage(region.maskCanvas,0,0);
      data = tctx.getImageData(0,0,state.width,state.height).data;
    }
    region.maskCache = { feather, data };
    return data;
  }

  function hexToHsl(hex) {
    const rgb = hexToRgb(hex);
    let r = rgb.r/255, g=rgb.g/255, b=rgb.b/255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b); let h=0,s=0; const l=(max+min)/2;
    const d=max-min;
    if (d !== 0) {
      s=d/(1-Math.abs(2*l-1));
      switch(max){case r:h=((g-b)/d)%6;break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4;}
      h/=6; if(h<0)h+=1;
    }
    return {h,s,l};
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? {r:parseInt(m[1],16),g:parseInt(m[2],16),b:parseInt(m[3],16)} : {r:169,g:214,b:229};
  }

  function hslToRgb(h,s,l) {
    if (s === 0) { const v=Math.round(l*255); return [v,v,v]; }
    const q = l < .5 ? l*(1+s) : l+s-l*s;
    const p = 2*l-q;
    const hue = (t) => { t=(t+1)%1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
    return [Math.round(hue(h+1/3)*255),Math.round(hue(h)*255),Math.round(hue(h-1/3)*255)];
  }

  async function requestRender(immediate = false) {
    if (!state.sourceImage) return;
    if (state.rendering) { state.renderQueued = true; return; }
    if (!immediate) {
      clearTimeout(requestRender._t);
      requestRender._t = setTimeout(() => doRender(), 25);
      return;
    }
    return doRender();
  }

  async function doRender() {
    if (!state.sourcePixels || state.rendering) return;
    state.rendering = true;
    try {
      const src = state.sourcePixels.data;
      const out = new ImageData(new Uint8ClampedArray(src), state.width, state.height);
      const dst = out.data;
      for (const region of state.regions) {
        if (!region.visible || region.intensity <= 0) continue;
        const mask = getMaskPixels(region);
        const target = hexToHsl(region.color);
        const avgL = averageLightness(region, mask);
        const intensity = clamp(region.intensity,0,1);
        for (let i=0; i<src.length; i+=4) {
          const ma = (mask[i+3] / 255) * intensity;
          if (ma < 0.01) continue;
          const max = Math.max(src[i],src[i+1],src[i+2]);
          const min = Math.min(src[i],src[i+1],src[i+2]);
          const srcL = (max + min) / 510;
          // Preserve local light/shadow differences around the average of the selected source area.
          const newL = clamp(target.l + (srcL - avgL) * 0.86, 0.025, 0.975);
          const [nr,ng,nb] = hslToRgb(target.h, target.s, newL);
          dst[i]   = Math.round(dst[i]   * (1-ma) + nr * ma);
          dst[i+1] = Math.round(dst[i+1] * (1-ma) + ng * ma);
          dst[i+2] = Math.round(dst[i+2] * (1-ma) + nb * ma);
        }
      }
      renderCtx.putImageData(out,0,0);
      updateOverlay();
    } finally {
      state.rendering = false;
      if (state.renderQueued) { state.renderQueued = false; requestAnimationFrame(doRender); }
    }
  }

  function updateOverlay() {
    overlayCtx.clearRect(0,0,state.width,state.height);
    const r = selectedRegion();
    if (r && els.maskPreview.checked) {
      overlayCtx.save();
      overlayCtx.globalAlpha = .27;
      overlayCtx.fillStyle = "#00d7ff";
      overlayCtx.fillRect(0,0,state.width,state.height);
      overlayCtx.globalCompositeOperation = "destination-in";
      overlayCtx.drawImage(r.maskCanvas,0,0);
      overlayCtx.restore();
    }
    if (state.tool === "polygon" && state.polygonPoints.length) {
      overlayCtx.save();
      overlayCtx.strokeStyle = "#ffe86b";
      overlayCtx.fillStyle = "#ffe86b";
      overlayCtx.lineWidth = Math.max(2, 2/state.fitScale/state.zoom);
      overlayCtx.beginPath();
      state.polygonPoints.forEach((p,i) => i ? overlayCtx.lineTo(p.x,p.y) : overlayCtx.moveTo(p.x,p.y));
      overlayCtx.stroke();
      const rr = Math.max(3, 4/state.fitScale/state.zoom);
      state.polygonPoints.forEach(p => { overlayCtx.beginPath(); overlayCtx.arc(p.x,p.y,rr,0,Math.PI*2); overlayCtx.fill(); });
      overlayCtx.restore();
    }
  }

  function drawBrush(from, to, erase = false) {
    const r = selectedRegion(); if (!r) return;
    const ctx = r.maskCtx;
    ctx.save();
    ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    ctx.strokeStyle = erase ? "rgba(0,0,0,1)" : "rgba(255,255,255,1)";
    ctx.lineWidth = state.brushSize;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(from.x,from.y); ctx.lineTo(to.x,to.y); ctx.stroke(); ctx.restore();
    invalidateMask(r);
    updateOverlay();
  }

  function finishPolygon() {
    const r = selectedRegion();
    if (!r || state.polygonPoints.length < 3) return;
    r.maskCtx.save();
    r.maskCtx.fillStyle = "#fff";
    r.maskCtx.beginPath();
    state.polygonPoints.forEach((p,i) => i ? r.maskCtx.lineTo(p.x,p.y) : r.maskCtx.moveTo(p.x,p.y));
    r.maskCtx.closePath(); r.maskCtx.fill(); r.maskCtx.restore();
    invalidateMask(r);
    state.polygonPoints = [];
    els.finishPolygonBtn.disabled = true;
    setDirty(true); commitHistory(); requestRender(); updateOverlay();
  }

  function magicWand(point) {
    const r = selectedRegion(); if (!r || !state.sourcePixels) return;
    const w=state.width,h=state.height, src=state.sourcePixels.data;
    const sx=clamp(Math.floor(point.x),0,w-1), sy=clamp(Math.floor(point.y),0,h-1);
    const idx0=(sy*w+sx)*4; const tr=src[idx0],tg=src[idx0+1],tb=src[idx0+2];
    const tol=state.wandTolerance; const tol2=tol*tol*3;
    const visited=new Uint8Array(w*h); const queue=new Int32Array(w*h); let head=0,tail=0;
    queue[tail++]=sy*w+sx; visited[sy*w+sx]=1;
    const img=r.maskCtx.getImageData(0,0,w,h); const data=img.data;
    const matches=(p)=>{ const i=p*4,dr=src[i]-tr,dg=src[i+1]-tg,db=src[i+2]-tb; return dr*dr+dg*dg+db*db<=tol2; };
    while(head<tail){
      const p=queue[head++]; if(!matches(p)) continue;
      data[p*4+3]=255;
      const x=p%w,y=(p/w)|0;
      const add=(np)=>{ if(!visited[np]){visited[np]=1;queue[tail++]=np;} };
      if(x>0)add(p-1); if(x<w-1)add(p+1); if(y>0)add(p-w); if(y<h-1)add(p+w);
    }
    r.maskCtx.putImageData(img,0,0); invalidateMask(r); setDirty(true); commitHistory(); requestRender(); updateOverlay();
    showToast(`Magic Wand \u05e1\u05d9\u05de\u05df ${head.toLocaleString()} \u05e4\u05d9\u05e7\u05e1\u05dc\u05d9\u05dd \u05e9\u05e0\u05d1\u05d3\u05e7\u05d5`);
  }

  function sampleColor(point) {
    if (!state.sourceImage) return;
    const x=clamp(Math.floor(point.x),0,state.width-1), y=clamp(Math.floor(point.y),0,state.height-1);
    const pix=renderCtx.getImageData(x,y,1,1).data;
    const hex=`#${[pix[0],pix[1],pix[2]].map(v=>v.toString(16).padStart(2,"0")).join("")}`.toUpperCase();
    const r=selectedRegion();
    if (r) { r.color=hex; els.regionColor.value=hex; els.regionHex.value=hex; renderRegionList(); setDirty(true); commitHistory(); requestRender(); }
    else { navigator.clipboard?.writeText(hex); showToast(`${hex} \u05d4\u05d5\u05e2\u05ea\u05e7`); }
    setTool("pan");
  }

  function serializeProject(includeImage = false) {
    const data = {
      version: 1,
      name: currentProjectName(),
      regions: state.regions.map(r => ({
        id:r.id,name:r.name,color:r.color,visible:r.visible,intensity:r.intensity,feather:r.feather,
        mask:r.maskCanvas.toDataURL("image/png")
      }))
    };
    if (includeImage) data.imageData = state.imageDataUrl;
    return data;
  }

  async function restoreProject(projectData, imageDataUrl, { keepCloud = true } = {}) {
    if (!imageDataUrl) throw new Error("Project has no image");
    await loadImageDataUrl(imageDataUrl,{resetProject:!keepCloud});
    els.projectName.value=projectData.name||"\u05d2\u05dc\u05e9\u05df";
    state.regions=[];
    for (const rd of (projectData.regions||[])) {
      const maskCanvas=createMaskCanvas(); const maskCtx=maskCanvas.getContext("2d",{willReadFrequently:true});
      if (rd.mask) { const mi=await loadHtmlImage(rd.mask); maskCtx.drawImage(mi,0,0,state.width,state.height); }
      state.regions.push({id:rd.id||uuid(),name:rd.name||"\u05d0\u05d6\u05d5\u05e8",color:(rd.color||"#A9D6E5").toUpperCase(),visible:rd.visible!==false,intensity:rd.intensity??1,feather:rd.feather||0,maskCanvas,maskCtx,avgLightness:null,maskCache:null});
    }
    state.selectedRegionId=state.regions[0]?.id||null;
    state.history=[];state.historyIndex=-1;state.variants=[];state.polygonPoints=[];
    renderRegionList();renderRegionEditor();commitHistory();await requestRender(true);fitStage();updateAccessUi();setDirty(false);
  }

  function makeHistorySnapshot() {
    return {
      name: currentProjectName(),
      selectedRegionId: state.selectedRegionId,
      regions: state.regions.map(r=>({id:r.id,name:r.name,color:r.color,visible:r.visible,intensity:r.intensity,feather:r.feather,mask:r.maskCanvas.toDataURL("image/png")}))
    };
  }

  function commitHistory() {
    if (!state.sourceImage) return;
    const snap=makeHistorySnapshot();
    state.history=state.history.slice(0,state.historyIndex+1);
    state.history.push(snap);
    if(state.history.length>HISTORY_LIMIT)state.history.shift();
    state.historyIndex=state.history.length-1;
    updateHistoryButtons();
  }

  function updateHistoryButtons(){ els.undoBtn.disabled=state.historyIndex<=0; els.redoBtn.disabled=state.historyIndex<0||state.historyIndex>=state.history.length-1; }

  async function restoreHistory(index){
    const snap=state.history[index]; if(!snap)return;
    els.projectName.value=snap.name; state.regions=[];
    for(const rd of snap.regions){
      const c=createMaskCanvas(),ctx=c.getContext("2d",{willReadFrequently:true}); const im=await loadHtmlImage(rd.mask);ctx.drawImage(im,0,0);
      state.regions.push({...rd,maskCanvas:c,maskCtx:ctx,avgLightness:null,maskCache:null});
    }
    state.selectedRegionId=snap.selectedRegionId;state.historyIndex=index;renderRegionList();renderRegionEditor();updateHistoryButtons();await requestRender(true);updateOverlay();setDirty(true);
  }

  function validHex(v){return /^#[0-9A-F]{6}$/i.test(v);}
  function applyRegionColor(v, commit=false){const r=selectedRegion();if(!r)return;v=v.toUpperCase();if(!validHex(v))return;r.color=v;els.regionColor.value=v;els.regionHex.value=v;renderRegionList();setDirty(true);requestRender();if(commit)commitHistory();}

  async function exportPng(){
    if(!state.sourceImage)return; await requestRender(true);
    els.renderCanvas.toBlob(blob=>{ if(!blob)return; downloadBlob(blob, `${safeFilename(currentProjectName())}.png`); },"image/png");
  }

  function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function safeFilename(s){return s.replace(/[\\/:*?"<>|]+/g,"-").trim()||"surfboard";}

  function exportProjectBackup(){
    if(!state.sourceImage)return;const obj=serializeProject(true);const blob=new Blob([JSON.stringify(obj)],{type:"application/json"});downloadBlob(blob,`${safeFilename(currentProjectName())}.surfboard.json`);showToast("\u05e7\u05d5\u05d1\u05e5 \u05d2\u05d9\u05d1\u05d5\u05d9 \u05e0\u05d5\u05e6\u05e8");
  }

  async function importProjectBackup(file){
    try{const text=await file.text();const obj=JSON.parse(text);if(!obj.imageData||!Array.isArray(obj.regions))throw new Error("Invalid project");state.projectId=null;state.editToken=null;state.access="local";await restoreProject(obj,obj.imageData,{keepCloud:false});showToast("\u05d4\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05e0\u05d8\u05e2\u05df \u05de\u05d4\u05d2\u05d9\u05d1\u05d5\u05d9");}
    catch(e){console.error(e);showToast("\u05dc\u05d0 \u05e0\u05d9\u05ea\u05df \u05dc\u05e7\u05e8\u05d5\u05d0 \u05d0\u05ea \u05e7\u05d5\u05d1\u05e5 \u05d4\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",true);}
  }

  function cloudPayload(){return serializeProject(false);}

  async function ensureCloudImage() {
    if (!state.imageDataUrl) throw new Error("No image");
    let data=state.imageDataUrl;
    // Keep RPC payload practical. If needed, recompress JPEG progressively.
    if(data.length>3_000_000){
      const img=await loadHtmlImage(data); const c=document.createElement("canvas"); const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)); c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale); const ctx=c.getContext("2d");ctx.drawImage(img,0,0,c.width,c.height);
      for(const q of [.9,.82,.74,.66]){data=c.toDataURL("image/jpeg",q);if(data.length<=3_000_000)break;}
    }
    state.cloudImageDataUrl=data;return data;
  }

  async function createCloudProject({switchToNew=true}={}){
    if(!state.supabase) throw new Error("Supabase is not configured");
    if(!state.user) throw new Error("Authentication required");
    if(!state.sourceImage) throw new Error("No image");
    const editToken=uuid()+uuid();
    const image=await ensureCloudImage();
    setCloudStatus("שומר בענן…","warn");
    const {data,error}=await state.supabase.rpc("create_surfboard_project",{
      p_edit_token:editToken,
      p_image_data:image,
      p_project_data:cloudPayload()
    });
    if(error) throw error;
    const id=typeof data==="string"?data:(Array.isArray(data)?data[0]?.create_surfboard_project:data);
    if(!id) throw new Error("Cloud project ID was not returned");
    if(switchToNew){
      state.projectId=id;
      state.editToken=editToken;
      state.access="owner";
      setDirty(false);
      history.replaceState(null,"",ownerUrl(id));
      updateAccessUi();
    }
    setCloudStatus("שמור בענן","ok");
    return {id,editToken};
  }

  async function saveCloud(){
    try{
      if(!state.supabase) throw new Error("Supabase is not configured");
      if(!state.projectId){
        await createCloudProject();
        showToast("הפרויקט נשמר בענן");
        return;
      }

      setCloudStatus("שומר בענן…","warn");
      let data, error;
      if(state.access==="owner"){
        if(!state.user) throw new Error("Authentication required");
        ({data,error}=await state.supabase.rpc("save_owned_surfboard_project",{
          p_id:state.projectId,
          p_project_data:cloudPayload()
        }));
      } else if(state.access==="shared") {
        if(!state.editToken) throw new Error("Missing edit token");
        ({data,error}=await state.supabase.rpc("save_surfboard_project",{
          p_id:state.projectId,
          p_edit_token:state.editToken,
          p_project_data:cloudPayload()
        }));
      } else {
        throw new Error("Authentication required");
      }
      if(error) throw error;
      if(data!==true) throw new Error("Save rejected");
      setDirty(false);
      showToast("השינויים נשמרו בענן");
    }catch(e){
      console.error(e);
      setCloudStatus("שגיאת שמירה","err");
      showToast(cloudErrorMessage(e),true);
    }
  }

  function cloudErrorMessage(e){
    const msg=String(e?.message||e||"");
    const code=String(e?.code||"");
    if(code==="PGRST202" || /could not find the function|schema cache|function .* does not exist/i.test(msg)){
      return "Supabase עדיין לא מכיר את פונקציות הגרסה החדשה. הרץ את supabase-setup.sql המעודכן ב-SQL Editor, המתן כמה שניות ונסה שוב.";
    }
    if(/authentication required|not authenticated|jwt/i.test(msg)) return "יש להתחבר לחשבון הבעלים כדי לבצע את הפעולה הזאת.";
    if(/invalid login credentials/i.test(msg)) return "האימייל או הסיסמה אינם נכונים.";
    if(msg.includes("Failed to fetch")) return "לא ניתן להתחבר ל-Supabase. בדוק את config.js ואת החיבור לאינטרנט.";
    if(/Project not found|not owned/i.test(msg)) return "הפרויקט לא נמצא בחשבון הזה או שאין הרשאה אליו.";
    if(/Save rejected/i.test(msg)) return "השמירה נדחתה. ייתכן שקישור העריכה אינו תקף יותר.";
    return `שגיאת ענן${code ? ` (${code})` : ""}: ${msg}`;
  }

  async function saveAsCopy(){
    try{
      if(!state.user) throw new Error("Authentication required");
      await createCloudProject({switchToNew:true});
      showToast("נוצר עותק חדש בחשבון שלך");
    } catch(e){
      console.error(e);
      showToast(cloudErrorMessage(e),true);
    }
  }

  async function showShare(){
    try{
      if(!state.supabase) throw new Error("Supabase is not configured");
      if(state.dirty && state.projectId) await saveCloud();
      if(!state.projectId) await createCloudProject();

      let url;
      if(state.access==="owner"){
        url=await getOwnerShareUrl(state.projectId);
      } else if(state.access==="shared" && state.editToken){
        url=buildUrl(state.projectId,state.editToken);
      } else {
        throw new Error("Authentication required");
      }
      els.shareDialogText.textContent="הקישור מאפשר לפתוח, לערוך ולשמור את הפרויקט הזה בלבד. הוא אינו נותן גישה לרשימת הפרויקטים שלך.";
      els.shareUrl.value=url;
      els.shareDialog.showModal();
    }catch(e){
      console.error(e);
      showToast(cloudErrorMessage(e),true);
    }
  }

  async function loadCloudFromUrl(){
    const p=new URLSearchParams(location.search);
    const id=p.get("p");
    if(!id) return false;
    if(!state.supabase){
      showToast("הפרויקט מקושר לענן, אבל Supabase לא הוגדר ב-config.js",true);
      return true;
    }

    const hash=new URLSearchParams(location.hash.replace(/^#/,""));
    const token=hash.get("t");
    if(!token){
      if(!state.user){
        state.pendingOwnerProjectId=id;
        showAuthDialog("יש להתחבר לחשבון הבעלים כדי לפתוח את הפרויקט הזה.");
        return true;
      }
      await openOwnerProject(id,{updateUrl:false});
      return true;
    }

    setCloudStatus("טוען מהענן…","warn");
    const {data,error}=await state.supabase.rpc("get_surfboard_project",{p_id:id,p_token:token});
    if(error){
      console.error(error);
      showToast(cloudErrorMessage(error),true);
      setCloudStatus("שגיאת טעינה","err");
      return true;
    }
    const row=Array.isArray(data)?data[0]:data;
    if(!row){
      showToast("קישור העריכה אינו תקף או שאינו מורשה לפרויקט",true);
      setCloudStatus("אין הרשאה","err");
      return true;
    }
    state.projectId=id;
    state.editToken=token;
    state.access="shared";
    await restoreProject(row.project_data,row.image_data,{keepCloud:true});
    state.projectId=id;
    state.editToken=token;
    state.access="shared";
    setDirty(false);
    setCloudStatus("שמור בענן","ok");
    updateAccessUi();

    // If the owner opens an old edit link while signed in, keep that token as the
    // stable cross-device share token without changing the existing link.
    if(state.user){
      try{
        await state.supabase.rpc("adopt_owned_surfboard_edit_token",{p_id:id,p_edit_token:token});
      } catch { /* best effort only */ }
    }
    showToast("הפרויקט נטען מהענן");
    return true;
  }

  function addVariant(){
    if(!state.sourceImage)return;requestRender(true).then(()=>{
      if(state.variants.length>=4)state.variants.shift();
      state.variants.push({name:`\u05d2\u05e8\u05e1\u05d4 ${state.variants.length+1}`,dataUrl:els.renderCanvas.toDataURL("image/png")});
      els.compareBtn.disabled=false;showToast("\u05d4\u05d2\u05e8\u05e1\u05d4 \u05e0\u05d5\u05e1\u05e4\u05d4 \u05dc\u05d4\u05e9\u05d5\u05d5\u05d0\u05d4");
    });
  }

  function showCompare(){
    els.compareGrid.innerHTML="";
    if(!state.variants.length){els.compareGrid.innerHTML='<p class="empty-note">\u05e2\u05d3\u05d9\u05d9\u05df \u05dc\u05d0 \u05e0\u05e9\u05de\u05e8\u05d5 \u05d2\u05e8\u05e1\u05d0\u05d5\u05ea \u05dc\u05d4\u05e9\u05d5\u05d5\u05d0\u05d4.</p>';}
    state.variants.forEach((v,i)=>{
      const card=document.createElement("div");card.className="compare-card";card.innerHTML=`<img src="${v.dataUrl}" alt="${escapeHtml(v.name)}"><input class="text-input" value="${escapeHtml(v.name)}" aria-label="\u05e9\u05dd \u05d2\u05e8\u05e1\u05d4">`;
      card.querySelector("input").addEventListener("input",e=>v.name=e.target.value);els.compareGrid.appendChild(card);
    });
    els.compareDialog.showModal();
  }

  function clearMask(){const r=selectedRegion();if(!r)return;r.maskCtx.clearRect(0,0,state.width,state.height);invalidateMask(r);setDirty(true);commitHistory();requestRender();updateOverlay();}

  function duplicateRegion(){
    const r=selectedRegion();if(!r)return;const c=createMaskCanvas(),ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(r.maskCanvas,0,0);const nr={...r,id:uuid(),name:`${r.name} copy`,maskCanvas:c,maskCtx:ctx,avgLightness:null,maskCache:null};state.regions.push(nr);state.selectedRegionId=nr.id;renderRegionList();renderRegionEditor();setDirty(true);commitHistory();requestRender();
  }

  function deleteRegion(){const i=state.regions.findIndex(r=>r.id===state.selectedRegionId);if(i<0)return;state.regions.splice(i,1);state.selectedRegionId=state.regions[Math.max(0,i-1)]?.id||null;renderRegionList();renderRegionEditor();setDirty(true);commitHistory();requestRender();updateOverlay();}

  function resetApp(){
    if(state.dirty&&!confirm("\u05d9\u05e9 \u05e9\u05d9\u05e0\u05d5\u05d9\u05d9\u05dd \u05e9\u05dc\u05d0 \u05e0\u05e9\u05de\u05e8\u05d5. \u05dc\u05d4\u05ea\u05d7\u05d9\u05dc \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05d7\u05d3\u05e9?"))return;
    Object.assign(state,{imageDataUrl:null,sourceImage:null,sourcePixels:null,width:0,height:0,regions:[],selectedRegionId:null,polygonPoints:[],history:[],historyIndex:-1,variants:[],projectId:null,editToken:null,access:"local",dirty:false});
    els.canvasStage.hidden=true;els.emptyState.hidden=false;els.projectName.value="\u05d2\u05dc\u05e9\u05df \u05d7\u05d3\u05e9";history.replaceState(null,"",baseUrl());renderRegionList();renderRegionEditor();updateAccessUi();setCloudStatus(state.supabase?(state.user?"\u05e2\u05e0\u05df \u05de\u05d5\u05db\u05df":"\u05e2\u05e0\u05df \u05de\u05d5\u05db\u05df \u2014 \u05e0\u05d3\u05e8\u05e9\u05ea \u05db\u05e0\u05d9\u05e1\u05d4 \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8\u05d9\u05dd \u05e9\u05dc\u05da"):"\u05de\u05e6\u05d1 \u05de\u05e7\u05d5\u05de\u05d9 \u2014 \u05d4\u05d2\u05d3\u05e8 Supabase \u05dc\u05e9\u05d9\u05ea\u05d5\u05e3",state.supabase?(state.user?"ok":"warn"):"warn");
  }

  function bindEvents(){
    els.uploadBtn.addEventListener("click",()=>els.imageInput.click());els.emptyUploadBtn.addEventListener("click",()=>els.imageInput.click());
    els.imageInput.addEventListener("change",e=>{loadImageFile(e.target.files[0]);e.target.value="";});
    els.newBtn.addEventListener("click",resetApp);
    els.myProjectsBtn.addEventListener("click",()=>showProjectLibrary());
    els.refreshProjectsBtn.addEventListener("click",()=>renderProjectLibrary());
    els.ownerAuthBtn.addEventListener("click",()=>state.user?signOutOwner():showAuthDialog());
    els.authLoginBtn.addEventListener("click",signInOwner);
    [els.authEmail,els.authPassword].forEach(input=>input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();signInOwner();}}));

    els.addRegionBtn.addEventListener("click",()=>newRegion());
    els.deleteRegionBtn.addEventListener("click",deleteRegion);els.duplicateRegionBtn.addEventListener("click",duplicateRegion);els.clearMaskBtn.addEventListener("click",clearMask);
    els.projectName.addEventListener("input",()=>setDirty(true));els.projectName.addEventListener("change",commitHistory);
    els.regionName.addEventListener("input",()=>{const r=selectedRegion();if(!r)return;r.name=els.regionName.value;renderRegionList();setDirty(true);});els.regionName.addEventListener("change",commitHistory);
    els.regionColor.addEventListener("input",e=>applyRegionColor(e.target.value,false));els.regionColor.addEventListener("change",e=>applyRegionColor(e.target.value,true));
    els.regionHex.addEventListener("input",e=>{let v=e.target.value.trim();if(!v.startsWith("#"))v="#"+v;if(validHex(v))applyRegionColor(v,false);});els.regionHex.addEventListener("change",e=>{let v=e.target.value.trim();if(!v.startsWith("#"))v="#"+v;if(validHex(v))applyRegionColor(v,true);else renderRegionEditor();});
    document.querySelectorAll(".preset").forEach(b=>b.addEventListener("click",()=>applyRegionColor(b.dataset.color,true)));
    els.intensityRange.addEventListener("input",e=>{const r=selectedRegion();if(!r)return;r.intensity=Number(e.target.value)/100;els.intensityOut.textContent=`${e.target.value}%`;setDirty(true);requestRender();});els.intensityRange.addEventListener("change",commitHistory);
    els.featherRange.addEventListener("input",e=>{const r=selectedRegion();if(!r)return;r.feather=Number(e.target.value);r.maskCache=null;r.avgLightness=null;els.featherOut.textContent=`${e.target.value} px`;setDirty(true);requestRender();});els.featherRange.addEventListener("change",commitHistory);
    els.regionVisible.addEventListener("change",e=>{const r=selectedRegion();if(!r)return;r.visible=e.target.checked;renderRegionList();setDirty(true);commitHistory();requestRender();});els.maskPreview.addEventListener("change",updateOverlay);
    els.eyedropperBtn.addEventListener("click",()=>setTool("eyedropper"));
    document.querySelectorAll("[data-tool]").forEach(b=>b.addEventListener("click",()=>{if(!selectedRegion()&&!['pan','eyedropper'].includes(b.dataset.tool)){showToast("בחר או הוסף אזור קודם",true);return;}setTool(b.dataset.tool);}));
    els.finishPolygonBtn.addEventListener("click",finishPolygon);
    els.brushSize.addEventListener("input",e=>{state.brushSize=Number(e.target.value);els.brushSizeOut.textContent=`${e.target.value} px`;});
    els.wandTolerance.addEventListener("input",e=>{state.wandTolerance=Number(e.target.value);els.wandToleranceOut.textContent=e.target.value;});
    els.zoomOutBtn.addEventListener("click",()=>setZoom(state.zoom/1.2));els.zoomInBtn.addEventListener("click",()=>setZoom(state.zoom*1.2));els.zoomResetBtn.addEventListener("click",()=>setZoom(1));els.fitBtn.addEventListener("click",fitStage);
    els.undoBtn.addEventListener("click",()=>{if(state.historyIndex>0)restoreHistory(state.historyIndex-1);});els.redoBtn.addEventListener("click",()=>{if(state.historyIndex<state.history.length-1)restoreHistory(state.historyIndex+1);});
    els.exportPngBtn.addEventListener("click",exportPng);els.exportProjectBtn.addEventListener("click",exportProjectBackup);els.importProjectBtn.addEventListener("click",()=>els.projectInput.click());els.projectInput.addEventListener("change",e=>{importProjectBackup(e.target.files[0]);e.target.value="";});
    els.saveCloudBtn.addEventListener("click",saveCloud);els.saveAsCopyBtn.addEventListener("click",saveAsCopy);els.shareEditBtn.addEventListener("click",showShare);
    els.copyShareBtn.addEventListener("click",async()=>{await copyText(els.shareUrl.value);showToast("קישור העריכה הועתק");});
    els.nativeShareBtn.addEventListener("click",async()=>{if(navigator.share){try{await navigator.share({title:currentProjectName(),url:els.shareUrl.value});}catch{}}else{showToast("שיתוף מובנה אינו נתמך בדפדפן הזה",true);}});
    els.addVariantBtn.addEventListener("click",addVariant);els.compareBtn.addEventListener("click",showCompare);els.clearVariantsBtn.addEventListener("click",()=>{state.variants=[];els.compareBtn.disabled=true;els.compareGrid.innerHTML="";showToast("הגרסאות נוקו");});

    els.overlayCanvas.addEventListener("pointerdown",onPointerDown);els.overlayCanvas.addEventListener("pointermove",onPointerMove);els.overlayCanvas.addEventListener("pointerup",onPointerUp);els.overlayCanvas.addEventListener("pointercancel",onPointerUp);els.overlayCanvas.addEventListener("dblclick",e=>{if(state.tool==="polygon"){e.preventDefault();finishPolygon();}});
    els.canvasViewport.addEventListener("wheel",e=>{if(!state.sourceImage)return;if(e.ctrlKey||e.metaKey){e.preventDefault();setZoom(state.zoom*(e.deltaY<0?1.12:.89));}},{passive:false});
    window.addEventListener("resize",()=>{if(state.sourceImage)fitStage();});
    window.addEventListener("beforeunload",e=>{if(state.dirty&&state.projectId&&(state.access==="owner"||state.access==="shared")){e.preventDefault();e.returnValue="";}});

    ["dragenter","dragover"].forEach(type=>els.uploadDrop.addEventListener(type,e=>{e.preventDefault();els.uploadDrop.style.borderColor="#a9d6e5";}));
    ["dragleave","drop"].forEach(type=>els.uploadDrop.addEventListener(type,e=>{e.preventDefault();els.uploadDrop.style.borderColor="";}));
    els.uploadDrop.addEventListener("drop",e=>loadImageFile(e.dataTransfer.files[0]));
  }

  function onPointerDown(e){
    if(!state.sourceImage)return;els.overlayCanvas.setPointerCapture?.(e.pointerId);
    if(state.tool==="pan"){state.panning=true;state.panStart={x:e.clientX-state.panX,y:e.clientY-state.panY};els.overlayCanvas.style.cursor="grabbing";return;}
    const p=canvasPoint(e);
    if(state.tool==="polygon"){state.polygonPoints.push(p);els.finishPolygonBtn.disabled=state.polygonPoints.length<3;updateOverlay();return;}
    if(state.tool==="wand"){magicWand(p);return;}
    if(state.tool==="eyedropper"){sampleColor(p);return;}
    if(state.tool==="brush"||state.tool==="eraser"){if(!selectedRegion())return;state.drawing=true;state.lastPoint=p;drawBrush(p,p,state.tool==="eraser");}
  }
  function onPointerMove(e){
    if(state.panning){state.panX=e.clientX-state.panStart.x;state.panY=e.clientY-state.panStart.y;applyStageTransform();return;}
    if(state.drawing&&(state.tool==="brush"||state.tool==="eraser")){const p=canvasPoint(e);drawBrush(state.lastPoint,p,state.tool==="eraser");state.lastPoint=p;}
  }
  function onPointerUp(e){
    if(state.panning){state.panning=false;els.overlayCanvas.style.cursor="grab";return;}
    if(state.drawing){state.drawing=false;setDirty(true);commitHistory();requestRender();}
  }

  async function init(){
    initSupabase();
    bindEvents();
    renderRegionList();
    renderRegionEditor();
    updateHistoryButtons();
    updateAccessUi();

    if(state.supabase){
      await refreshAuthUser();
      if(state.user) await migrateLegacyEditTokens();
    }

    let loadedFromUrl=false;
    try{loadedFromUrl=await loadCloudFromUrl();}
    catch(e){console.error(e);showToast(cloudErrorMessage(e),true);}

    if(!loadedFromUrl && state.supabase){
      if(state.user) await showProjectLibrary();
      else if(!hasSharedTokenInUrl()) showAuthDialog("התחבר כדי לראות את כל הפרויקטים שלך מכל מכשיר.");
    }
  }

  init();
})();
