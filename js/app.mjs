import {
  createBackupExport,
  createInitialState,
  createRestaurantRecord,
  createRestaurantsExport,
  createSkippedRecord,
  getCandidatePool,
  isWeekday,
  localDateKey,
  pickWeighted,
  removeHistoryRecord,
  upsertHistory,
  validateBackupDocument,
  validateRestaurantsDocument,
  validateState
} from "./core.mjs";

const STORAGE_KEY = "lunch-picker.state.v1";
const SCOPE_LABELS = {
  primary: "楼下",
  secondary: "出去走走",
  all: "都可以"
};
const REASON_LABELS = {
  leave: "请假",
  company_elsewhere: "公司聚餐去了白名单外",
  other: "其他原因"
};
const SOURCE_LABELS = {
  random: "随机确认",
  manual: "手动记录",
  company: "公司聚餐"
};

const elements = {};
let state = null;
let currentRestaurant = null;
let sessionSeenIds = new Set();
let editingDate = null;
let guideScope = "all";
let defaultRestaurantsById = new Map();

function byId(id) {
  return document.getElementById(id);
}

function cacheElements() {
  [
    "header-date",
    "draw-button",
    "draw-message",
    "today-status",
    "today-status-title",
    "today-status-badge",
    "today-status-detail",
    "manual-today-button",
    "skip-today-button",
    "result-section",
    "result-scope",
    "result-price",
    "result-name",
    "result-cuisine",
    "result-location",
    "result-walk-row",
    "result-walk",
    "result-map",
    "confirm-button",
    "reroll-button",
    "history-list",
    "add-history-button",
    "history-count",
    "restaurant-count",
    "guide-catalog-summary",
    "restaurant-directory",
    "export-backup-button",
    "export-restaurants-button",
    "import-backup-input",
    "import-restaurants-input",
    "data-message",
    "record-dialog",
    "record-form",
    "record-dialog-title",
    "close-dialog-button",
    "cancel-dialog-button",
    "record-date",
    "record-restaurant",
    "record-source",
    "restaurant-fields",
    "skip-field",
    "record-reason",
    "record-error",
    "delete-record-button"
  ].forEach((id) => {
    elements[id] = byId(id);
  });
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function parseLocalDate(dateKey) {
  const parts = dateKey.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], 12);
}

function previousWeekday(date = new Date()) {
  const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  while (!isWeekday(localDateKey(candidate))) {
    candidate.setDate(candidate.getDate() - 1);
  }
  return localDateKey(candidate);
}

function formatHeaderDate(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

function formatHistoryDate(dateKey) {
  const date = parseLocalDate(dateKey);
  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(date),
    weekday: new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date)
  };
}

function getTodayRecord() {
  const today = localDateKey();
  return state.history.find((record) => record.date === today) || null;
}

function commitState(nextState) {
  const validated = validateState(nextState);
  const serialized = JSON.stringify(validated);
  localStorage.setItem(STORAGE_KEY, serialized);
  state = validated;
}

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.style.color = isError ? "var(--danger)" : "";
}

function renderTodayStatus() {
  const today = localDateKey();
  const weekday = isWeekday(today);
  const record = getTodayRecord();

  elements["manual-today-button"].disabled = !weekday;
  elements["skip-today-button"].disabled = !weekday;

  if (!weekday) {
    elements["today-status-title"].textContent = "今天是周末";
    elements["today-status-badge"].textContent = "自动忽略";
    elements["today-status-badge"].className = "badge badge-muted";
    elements["today-status-detail"].textContent = "周末不创建午餐记录，也不会消耗冷却次数；仍可试抽餐厅。";
    return;
  }

  if (!record) {
    elements["today-status-title"].textContent = "还没有记录";
    elements["today-status-badge"].textContent = "未记录";
    elements["today-status-badge"].className = "badge badge-muted";
    elements["today-status-detail"].textContent = "抽到满意的餐厅后再确认，或者手动补一条。";
    return;
  }

  if (record.status === "restaurant") {
    elements["today-status-title"].textContent = record.restaurant_name;
    elements["today-status-badge"].textContent = "已记录";
    elements["today-status-badge"].className = "badge";
    elements["today-status-detail"].textContent = SOURCE_LABELS[record.source] || "餐厅午餐";
  } else {
    elements["today-status-title"].textContent = "今天跳过";
    elements["today-status-badge"].textContent = "不计冷却";
    elements["today-status-badge"].className = "badge badge-muted";
    elements["today-status-detail"].textContent = REASON_LABELS[record.reason] || record.reason;
  }
}

function renderHistory() {
  const list = elements["history-list"];
  list.replaceChildren();

  const records = [...state.history].sort((left, right) => right.date.localeCompare(left.date));
  if (records.length === 0) {
    list.append(makeElement("p", "empty-state", "还没有午餐记录。确认一次抽签结果，或者补记过去的工作日。"));
    return;
  }

  records.forEach((record) => {
    const dateParts = formatHistoryDate(record.date);
    const item = makeElement("article", "history-item");
    const date = makeElement("div", "history-date");
    date.append(makeElement("strong", "", dateParts.day));
    date.append(makeElement("small", "", dateParts.month + " · " + dateParts.weekday));

    const detail = makeElement("div", "history-detail");
    if (record.status === "restaurant") {
      detail.append(makeElement("h2", "", record.restaurant_name));
      const source = SOURCE_LABELS[record.source] || "餐厅午餐";
      const weekendNote = isWeekday(record.date) ? "" : " · 周末，不计冷却";
      detail.append(makeElement("p", "", source + weekendNote));
    } else {
      detail.append(makeElement("h2", "", "跳过"));
      const reason = REASON_LABELS[record.reason] || record.reason;
      const weekendNote = isWeekday(record.date) ? "" : " · 周末，不计冷却";
      detail.append(makeElement("p", "", reason + weekendNote));
    }

    const editButton = makeElement("button", "button button-quiet", "修改");
    editButton.type = "button";
    editButton.addEventListener("click", () => openRecordDialog(record));
    item.append(date, detail, editButton);
    list.append(item);
  });
}

function renderDataCounts() {
  const activeRestaurants = state.restaurants.filter((restaurant) => restaurant.active !== false);
  const primaryCount = activeRestaurants.filter((restaurant) => restaurant.scope === "primary").length;
  const secondaryCount = activeRestaurants.filter((restaurant) => restaurant.scope === "secondary").length;
  elements["restaurant-count"].textContent = primaryCount + " + " + secondaryCount + " 家";
  elements["history-count"].textContent = state.history.length + " 条";
}

function getGuideMetadata(restaurant) {
  const defaultRestaurant = defaultRestaurantsById.get(restaurant.id) || {};
  return {
    recommendedDishes: restaurant.recommended_dishes || defaultRestaurant.recommended_dishes || [],
    sourceUrls: restaurant.source_urls || defaultRestaurant.source_urls || []
  };
}

function createRestaurantDirectoryCard(restaurant) {
  const metadata = getGuideMetadata(restaurant);
  const card = makeElement("article", "restaurant-directory-card");
  const heading = makeElement("div", "restaurant-directory-heading");
  const monogram = makeElement("span", "restaurant-monogram", restaurant.name.trim().charAt(0).toUpperCase());
  monogram.setAttribute("aria-hidden", "true");

  const titleGroup = makeElement("div", "restaurant-title-group");
  const badges = makeElement("div", "restaurant-badges");
  badges.append(makeElement("span", "badge", SCOPE_LABELS[restaurant.scope]));
  badges.append(makeElement("span", "badge badge-muted", "参考 ¥" + restaurant.price_per_person + "/人"));
  titleGroup.append(badges);
  titleGroup.append(makeElement("h3", "", restaurant.name));
  titleGroup.append(makeElement("p", "restaurant-cuisine", restaurant.cuisine));
  heading.append(monogram, titleGroup);

  const facts = makeElement("dl", "restaurant-directory-facts");
  const location = makeElement("div", "");
  location.append(makeElement("dt", "", "位置"));
  location.append(makeElement("dd", "", restaurant.location));
  facts.append(location);
  if (restaurant.scope === "secondary") {
    const walk = makeElement("div", "");
    walk.append(makeElement("dt", "", "步行"));
    walk.append(makeElement("dd", "", "约 " + restaurant.walking_minutes + " 分钟（单程）"));
    facts.append(walk);
  }

  card.append(heading, facts);

  if (metadata.recommendedDishes.length > 0) {
    const recommendation = makeElement("div", "restaurant-recommendation");
    recommendation.append(makeElement("strong", "", "午餐建议"));
    recommendation.append(makeElement("p", "", metadata.recommendedDishes.join(" · ")));
    card.append(recommendation);
  }

  if (restaurant.pork_free_hint) {
    const porkFree = makeElement("p", "restaurant-pork-free");
    porkFree.append(makeElement("strong", "", "无猪肉提示："));
    porkFree.append(document.createTextNode(restaurant.pork_free_hint));
    card.append(porkFree);
  }

  const actions = makeElement("div", "restaurant-directory-actions");
  const mapLink = makeElement("a", "button button-secondary", "打开地图");
  mapLink.href = getMapUrl(restaurant);
  mapLink.target = "_blank";
  mapLink.rel = "noopener noreferrer";
  actions.append(mapLink);

  if (metadata.sourceUrls.length > 0) {
    const sourceLink = makeElement("a", "button button-quiet", "公开资料");
    sourceLink.href = metadata.sourceUrls[0];
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener noreferrer";
    actions.append(sourceLink);
  }
  card.append(actions);
  return card;
}

function renderGuide() {
  const activeRestaurants = state.restaurants.filter((restaurant) => restaurant.active !== false);
  const primaryCount = activeRestaurants.filter((restaurant) => restaurant.scope === "primary").length;
  const secondaryCount = activeRestaurants.filter((restaurant) => restaurant.scope === "secondary").length;
  const verifiedAt = state.restaurants_verified_at || "未标注";
  elements["guide-catalog-summary"].textContent = "当前浏览器共 " + activeRestaurants.length
    + " 家：楼下 " + primaryCount + " 家，附近 " + secondaryCount
    + " 家。名单核验日期：" + verifiedAt + "。";

  const directory = elements["restaurant-directory"];
  directory.replaceChildren();
  const visibleRestaurants = activeRestaurants.filter((restaurant) => (
    guideScope === "all" || restaurant.scope === guideScope
  ));
  if (visibleRestaurants.length === 0) {
    directory.append(makeElement("p", "empty-state", "当前范围没有可展示的餐厅。"));
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleRestaurants.forEach((restaurant) => {
    fragment.append(createRestaurantDirectoryCard(restaurant));
  });
  directory.append(fragment);
}

function renderAll() {
  const selectedScope = document.querySelector('input[name="scope"][value="' + state.settings.scope + '"]');
  if (selectedScope) {
    selectedScope.checked = true;
  }
  renderTodayStatus();
  renderHistory();
  renderDataCounts();
  renderGuide();
}

function getMapUrl(restaurant) {
  const keyword = encodeURIComponent(restaurant.map_query);
  return "https://uri.amap.com/search?keyword=" + keyword
    + "&city=" + encodeURIComponent("上海")
    + "&src=lunch-picker&coordinate=gaode&callnative=1";
}

function renderResult(restaurant) {
  currentRestaurant = restaurant;
  elements["result-scope"].textContent = SCOPE_LABELS[restaurant.scope];
  elements["result-scope"].className = "badge";
  elements["result-price"].textContent = "参考人均 ¥" + restaurant.price_per_person;
  elements["result-name"].textContent = restaurant.name;
  elements["result-cuisine"].textContent = restaurant.cuisine;
  elements["result-location"].textContent = restaurant.location;
  elements["result-map"].href = getMapUrl(restaurant);

  if (restaurant.scope === "secondary") {
    elements["result-walk-row"].hidden = false;
    elements["result-walk"].textContent = "约 " + restaurant.walking_minutes + " 分钟（单程）";
  } else {
    elements["result-walk-row"].hidden = true;
    elements["result-walk"].textContent = "";
  }

  const weekend = !isWeekday(localDateKey());
  elements["confirm-button"].disabled = weekend;
  elements["confirm-button"].textContent = weekend ? "周末不记录" : "就吃这家";
  elements["result-section"].hidden = false;
  elements["result-section"].scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function resetDrawSession(clearMessage = true) {
  currentRestaurant = null;
  sessionSeenIds = new Set();
  elements["result-section"].hidden = true;
  if (clearMessage) {
    setMessage(elements["draw-message"], "");
  }
}

function drawRestaurant(startNewSession) {
  if (startNewSession) {
    resetDrawSession();
  }

  const options = {
    scope: state.settings.scope,
    targetDate: localDateKey(),
    cooldownMeals: state.settings.cooldown_meals,
    cooldownWeight: state.settings.cooldown_weight,
    seenIds: sessionSeenIds
  };
  const pool = getCandidatePool(state.restaurants, state.history, options);
  const restaurant = pickWeighted(pool);

  if (!restaurant) {
    currentRestaurant = null;
    elements["result-section"].hidden = true;
    setMessage(elements["draw-message"], "本轮候选已经用完。可以重新开始，或者切换范围。", true);
    return;
  }

  sessionSeenIds.add(restaurant.id);
  renderResult(restaurant);
  const remaining = getCandidatePool(state.restaurants, state.history, {
    ...options,
    seenIds: sessionSeenIds
  }).length;
  setMessage(elements["draw-message"], "本轮尚有 " + remaining + " 家未出现。只在确认后写入记录。");
}

function confirmCurrentRestaurant() {
  if (!currentRestaurant) {
    return;
  }

  const today = localDateKey();
  if (!isWeekday(today)) {
    setMessage(elements["draw-message"], "周末不会创建午餐记录。", true);
    return;
  }

  const existing = getTodayRecord();
  if (existing && !window.confirm("今天已有记录，是否用这家餐厅替换？")) {
    return;
  }

  try {
    const record = createRestaurantRecord(currentRestaurant, today, "random");
    commitState({
      ...state,
      history: upsertHistory(state.history, record)
    });
    resetDrawSession(false);
    setMessage(elements["draw-message"], "已记录：" + record.restaurant_name + "。祝你午餐愉快。" );
    renderAll();
  } catch (error) {
    setMessage(elements["draw-message"], "保存失败：" + error.message, true);
  }
}

function populateRestaurantSelect() {
  const select = elements["record-restaurant"];
  select.replaceChildren();
  const restaurants = state.restaurants
    .filter((restaurant) => restaurant.active !== false)
    .sort((left, right) => {
      if (left.scope !== right.scope) {
        return left.scope === "primary" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, "zh-CN");
    });

  restaurants.forEach((restaurant) => {
    const option = document.createElement("option");
    option.value = restaurant.id;
    option.textContent = "[" + SCOPE_LABELS[restaurant.scope] + "] " + restaurant.name + " — " + restaurant.location;
    select.append(option);
  });
}

function updateRecordFieldVisibility() {
  const status = document.querySelector('input[name="record-status"]:checked').value;
  const skipped = status === "skipped";
  elements["restaurant-fields"].hidden = skipped;
  elements["skip-field"].hidden = !skipped;
}

function openRecordDialog(record = null, preferredStatus = "restaurant") {
  editingDate = record ? record.date : null;
  elements["record-dialog-title"].textContent = record ? "修改午餐记录" : "补记午餐";
  elements["record-date"].value = record ? record.date : previousWeekday();
  elements["record-error"].textContent = "";
  elements["delete-record-button"].hidden = !record;

  populateRestaurantSelect();
  const status = record ? record.status : preferredStatus;
  const statusRadio = document.querySelector('input[name="record-status"][value="' + status + '"]');
  statusRadio.checked = true;

  if (record && record.status === "restaurant") {
    const optionExists = [...elements["record-restaurant"].options]
      .some((option) => option.value === record.restaurant_id);
    if (!optionExists) {
      const orphanOption = document.createElement("option");
      orphanOption.value = record.restaurant_id;
      orphanOption.textContent = "[已移出白名单] " + record.restaurant_name;
      elements["record-restaurant"].append(orphanOption);
    }
    elements["record-restaurant"].value = record.restaurant_id;
    elements["record-source"].value = record.source === "random" ? "manual" : record.source;
  } else if (record && record.status === "skipped") {
    const reasonExists = [...elements["record-reason"].options]
      .some((option) => option.value === record.reason);
    if (!reasonExists) {
      const reasonOption = document.createElement("option");
      reasonOption.value = record.reason;
      reasonOption.textContent = record.reason;
      elements["record-reason"].append(reasonOption);
    }
    elements["record-reason"].value = record.reason;
  }

  updateRecordFieldVisibility();
  elements["record-dialog"].showModal();
}

function closeRecordDialog() {
  editingDate = null;
  elements["record-dialog"].close();
}

function saveRecordFromForm(event) {
  event.preventDefault();
  elements["record-error"].textContent = "";

  try {
    const date = elements["record-date"].value;
    if (!isWeekday(date)) {
      throw new Error("周末自动忽略，请选择一个工作日。");
    }

    const existingOnNewDate = state.history.find((record) => record.date === date);
    if (existingOnNewDate && date !== editingDate
      && !window.confirm("这个工作日已有记录，是否替换？")) {
      return;
    }

    const status = document.querySelector('input[name="record-status"]:checked').value;
    let record;
    if (status === "restaurant") {
      const selectedRestaurantId = elements["record-restaurant"].value;
      let restaurant = state.restaurants.find((item) => item.id === selectedRestaurantId);
      if (!restaurant && editingDate) {
        const original = state.history.find((item) => item.date === editingDate);
        if (original && original.status === "restaurant" && original.restaurant_id === selectedRestaurantId) {
          restaurant = {
            id: original.restaurant_id,
            name: original.restaurant_name
          };
        }
      }
      if (!restaurant) {
        throw new Error("所选餐厅已不在当前白名单中，请选择其他餐厅。");
      }
      record = createRestaurantRecord(restaurant, date, elements["record-source"].value);
    } else {
      record = createSkippedRecord(date, elements["record-reason"].value);
    }

    let nextHistory = state.history;
    if (editingDate && editingDate !== date) {
      nextHistory = removeHistoryRecord(nextHistory, editingDate);
    }
    nextHistory = upsertHistory(nextHistory, record);
    commitState({ ...state, history: nextHistory });
    closeRecordDialog();
    resetDrawSession();
    renderAll();
  } catch (error) {
    elements["record-error"].textContent = error.message;
  }
}

function deleteEditingRecord() {
  if (!editingDate || !window.confirm("清除这一天的午餐记录？清除后将恢复为未记录。")) {
    return;
  }

  try {
    commitState({
      ...state,
      history: removeHistoryRecord(state.history, editingDate)
    });
    closeRecordDialog();
    resetDrawSession();
    renderAll();
  } catch (error) {
    elements["record-error"].textContent = error.message;
  }
}

function showView(name) {
  const validName = ["today", "history", "data", "guide"].includes(name) ? name : "today";
  document.querySelectorAll(".view").forEach((view) => {
    view.hidden = view.id !== "view-" + validName;
  });
  document.querySelectorAll(".nav-button").forEach((button) => {
    const active = button.dataset.view === validName;
    button.classList.toggle("is-active", active);
    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });
  window.history.replaceState(null, "", "#" + validName);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function downloadJson(filename, jsonDocument) {
  const json = JSON.stringify(jsonDocument, null, 2) + "\n";
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function readJsonFile(file) {
  if (!file) {
    throw new Error("没有选择文件。");
  }
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON。");
  }
}

async function importBackup(file) {
  const document = await readJsonFile(file);
  const importedState = validateBackupDocument(document);
  const message = "将用备份中的 " + importedState.restaurants.length + " 家餐厅和 "
    + importedState.history.length + " 条历史整体替换当前本地数据。是否继续？";
  if (!window.confirm(message)) {
    return false;
  }
  commitState(importedState);
  return true;
}

async function importRestaurants(file) {
  const document = await readJsonFile(file);
  const imported = validateRestaurantsDocument(document);
  const message = "将用文件中的 " + imported.restaurants.length
    + " 家餐厅替换当前白名单，个人历史会保留。是否继续？";
  if (!window.confirm(message)) {
    return false;
  }
  commitState({
    ...state,
    restaurants_verified_at: imported.verified_at,
    restaurants: imported.restaurants
  });
  return true;
}

async function handleImport(input, kind) {
  setMessage(elements["data-message"], "");
  try {
    const changed = kind === "backup"
      ? await importBackup(input.files[0])
      : await importRestaurants(input.files[0]);
    if (changed) {
      resetDrawSession();
      renderAll();
      setMessage(elements["data-message"], "导入完成，本地数据已经替换。" );
    } else {
      setMessage(elements["data-message"], "已取消导入，当前数据没有变化。" );
    }
  } catch (error) {
    setMessage(elements["data-message"], "导入失败：" + error.message + " 当前数据没有变化。", true);
  } finally {
    input.value = "";
  }
}

function bindEvents() {
  document.querySelectorAll('input[name="scope"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) {
        return;
      }
      try {
        commitState({
          ...state,
          settings: { ...state.settings, scope: input.value }
        });
        resetDrawSession();
      } catch (error) {
        setMessage(elements["draw-message"], "保存范围失败：" + error.message, true);
      }
    });
  });

  elements["draw-button"].addEventListener("click", () => drawRestaurant(true));
  elements["reroll-button"].addEventListener("click", () => drawRestaurant(false));
  elements["confirm-button"].addEventListener("click", confirmCurrentRestaurant);
  elements["manual-today-button"].addEventListener("click", () => openRecordDialog(null, "restaurant"));
  elements["skip-today-button"].addEventListener("click", () => openRecordDialog(null, "skipped"));
  elements["add-history-button"].addEventListener("click", () => openRecordDialog());

  document.querySelectorAll('input[name="record-status"]').forEach((input) => {
    input.addEventListener("change", updateRecordFieldVisibility);
  });
  elements["record-form"].addEventListener("submit", saveRecordFromForm);
  elements["close-dialog-button"].addEventListener("click", closeRecordDialog);
  elements["cancel-dialog-button"].addEventListener("click", closeRecordDialog);
  elements["delete-record-button"].addEventListener("click", deleteEditingRecord);

  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showView(link.dataset.nav);
    });
  });

  document.querySelectorAll("[data-guide-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      guideScope = button.dataset.guideScope;
      document.querySelectorAll("[data-guide-scope]").forEach((scopeButton) => {
        const active = scopeButton === button;
        scopeButton.classList.toggle("is-active", active);
        scopeButton.setAttribute("aria-pressed", String(active));
      });
      renderGuide();
    });
  });

  elements["export-backup-button"].addEventListener("click", () => {
    downloadJson("lunch-picker-backup.json", createBackupExport(state));
  });
  elements["export-restaurants-button"].addEventListener("click", () => {
    downloadJson("restaurants.json", createRestaurantsExport(state));
  });
  elements["import-backup-input"].addEventListener("change", () => {
    handleImport(elements["import-backup-input"], "backup");
  });
  elements["import-restaurants-input"].addEventListener("change", () => {
    handleImport(elements["import-restaurants-input"], "restaurants");
  });
}

async function loadInitialState() {
  const response = await fetch("./data/restaurants.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("无法读取默认餐厅配置（HTTP " + response.status + "）。");
  }
  const defaultDocument = validateRestaurantsDocument(await response.json());
  defaultRestaurantsById = new Map(defaultDocument.restaurants.map((restaurant) => [restaurant.id, restaurant]));
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) {
    return createInitialState(defaultDocument);
  }

  try {
    return validateState(JSON.parse(stored));
  } catch (error) {
    throw new Error("浏览器本地数据无效，为避免覆盖已停止加载。可清除站点数据后重试。原因：" + error.message);
  }
}

async function start() {
  cacheElements();
  elements["header-date"].textContent = formatHeaderDate();

  try {
    state = await loadInitialState();
    bindEvents();
    const selectedScope = document.querySelector('input[name="scope"][value="' + state.settings.scope + '"]');
    selectedScope.checked = true;
    renderAll();
    showView(window.location.hash.replace("#", ""));
  } catch (error) {
    elements["draw-button"].disabled = true;
    setMessage(elements["draw-message"], "加载失败：" + error.message + " 请通过 HTTP 静态服务器访问网页。", true);
  }
}

start();
