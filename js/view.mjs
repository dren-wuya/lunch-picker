export const VIEW_INTENTS = Object.freeze([
  "changeScope",
  "draw",
  "confirmRestaurant",
  "saveRecord",
  "deleteRecord",
  "searchRestaurants",
  "queueName",
  "previewPendingNames",
  "confirmPendingNames",
  "removePendingName",
  "resolvePending",
  "setRestaurantHidden",
  "addPersonalRestaurant",
  "setAvoidPork",
  "previewBackup",
  "importBackup",
  "exportBackup"
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function assertExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  assert(actualKeys.length === sortedExpected.length
    && actualKeys.every((key, index) => key === sortedExpected[index]),
  label + " 字段必须恰好为：" + sortedExpected.join(", ") + "。");
}

const INTENT_PAYLOAD_KEYS = Object.freeze({
  changeScope: ["scope"],
  draw: ["startNewSession"],
  confirmRestaurant: ["confirmed"],
  saveRecord: ["originalDate", "date", "status", "restaurantId", "restaurantName", "source", "reason", "confirmed"],
  deleteRecord: ["date"],
  searchRestaurants: ["text"],
  queueName: ["name"],
  previewPendingNames: ["text"],
  confirmPendingNames: [],
  removePendingName: ["name"],
  resolvePending: ["name", "restaurantId", "confirmed"],
  setRestaurantHidden: ["restaurantId", "hidden"],
  addPersonalRestaurant: ["name", "scope", "location", "walkingMinutes", "aliases"],
  setAvoidPork: ["value"],
  previewBackup: ["document"],
  importBackup: ["document"],
  exportBackup: []
});

export function createViewIntent(type, payload = {}) {
  assert(VIEW_INTENTS.includes(type), "未知 view intent：" + type + "。");
  assert(isObject(payload), "view intent payload 必须是对象。");
  assertExactKeys(payload, INTENT_PAYLOAD_KEYS[type], type + " payload");

  if (type === "changeScope") {
    assert(["primary", "secondary", "all"].includes(payload.scope), "changeScope.scope 无效。");
  } else if (type === "draw") {
    assert(typeof payload.startNewSession === "boolean", "draw.startNewSession 必须是布尔值。");
  } else if (type === "confirmRestaurant") {
    assert(typeof payload.confirmed === "boolean", "confirmRestaurant.confirmed 必须是布尔值。");
  } else if (type === "saveRecord") {
    assert(payload.originalDate === null || typeof payload.originalDate === "string",
      "saveRecord.originalDate 无效。");
    assert(typeof payload.date === "string", "saveRecord.date 必须是字符串。");
    assert(["restaurant", "skipped"].includes(payload.status), "saveRecord.status 无效。");
    assert(typeof payload.restaurantId === "string", "saveRecord.restaurantId 必须是字符串。");
    assert(typeof payload.restaurantName === "string", "saveRecord.restaurantName 必须是字符串。");
    assert(typeof payload.source === "string", "saveRecord.source 必须是字符串。");
    assert(typeof payload.reason === "string", "saveRecord.reason 必须是字符串。");
    assert(typeof payload.confirmed === "boolean", "saveRecord.confirmed 必须是布尔值。");
  } else if (type === "deleteRecord") {
    assert(typeof payload.date === "string", "deleteRecord.date 必须是字符串。");
  } else if (type === "previewBackup" || type === "importBackup") {
    assert(isObject(payload.document), type + ".document 必须是对象。");
  } else if (["searchRestaurants", "previewPendingNames"].includes(type)) {
    assert(typeof payload.text === "string", type + ".text 必须是字符串。");
  } else if (["queueName", "removePendingName", "resolvePending"].includes(type)) {
    assert(isNonEmptyString(payload.name), type + ".name 无效。");
    if (type === "resolvePending") {
      assert(isNonEmptyString(payload.restaurantId), "resolvePending.restaurantId 无效。");
      assert(typeof payload.confirmed === "boolean", "resolvePending.confirmed 无效。");
    }
  } else if (type === "setRestaurantHidden") {
    assert(isNonEmptyString(payload.restaurantId), "setRestaurantHidden.restaurantId 无效。");
    assert(typeof payload.hidden === "boolean", "setRestaurantHidden.hidden 无效。");
  } else if (type === "setAvoidPork") {
    assert(typeof payload.value === "boolean", "setAvoidPork.value 无效。");
  } else if (type === "addPersonalRestaurant") {
    assert(isNonEmptyString(payload.name) && isNonEmptyString(payload.location), "请填写名称和文字位置。");
    assert(["primary", "secondary"].includes(payload.scope), "个人餐厅范围无效。");
    assert(payload.walkingMinutes === null || Number.isInteger(payload.walkingMinutes), "步行时间必须是整数。");
    assert(typeof payload.aliases === "string", "别名必须是文本。");
  }

  return Object.freeze({ type, ...payload });
}

function validateHistoryViewModel(record, label) {
  assert(isObject(record), label + " 必须是对象。");
  assertExactKeys(record, [
    "date",
    "status",
    "restaurantId",
    "restaurantName",
    "source",
    "reason",
    "isWeekday"
  ], label);
  assert(isNonEmptyString(record.date), label + ".date 无效。");
  assert(["restaurant", "skipped"].includes(record.status), label + ".status 无效。");
  assert(typeof record.isWeekday === "boolean", label + ".isWeekday 必须是布尔值。");

  if (record.status === "restaurant") {
    assert(record.restaurantId === null || isNonEmptyString(record.restaurantId),
      label + ".restaurantId 无效。");
    assert(isNonEmptyString(record.restaurantName), label + ".restaurantName 无效。");
    assert(["random", "manual", "company"].includes(record.source), label + ".source 无效。");
    assert(record.reason === null, label + ".reason 必须为 null。");
  } else {
    assert(record.restaurantId === null, label + ".restaurantId 必须为 null。");
    assert(record.restaurantName === null, label + ".restaurantName 必须为 null。");
    assert(record.source === null, label + ".source 必须为 null。");
    assert(record.reason === null || isNonEmptyString(record.reason), label + ".reason 无效。");
  }
}

function validateRestaurantViewModel(restaurant, label) {
  assert(isObject(restaurant), label + " 必须是对象。");
  assertExactKeys(restaurant, [
    "id",
    "name",
    "scope",
    "location",
    "cuisine",
    "pricePerPerson",
    "walkingMinutes",
    "dietaryNotice",
    "sourceUrls"
  ], label);
  assert(isNonEmptyString(restaurant.id), label + ".id 无效。");
  assert(isNonEmptyString(restaurant.name), label + ".name 无效。");
  assert(["primary", "secondary"].includes(restaurant.scope), label + ".scope 无效。");
  assert(isNonEmptyString(restaurant.location), label + ".location 无效。");
  assert(restaurant.cuisine === null || isNonEmptyString(restaurant.cuisine), label + ".cuisine 无效。");
  assert(restaurant.pricePerPerson === null
    || (Number.isFinite(restaurant.pricePerPerson) && restaurant.pricePerPerson > 0),
  label + ".pricePerPerson 无效。");
  if (restaurant.scope === "primary") {
    assert(restaurant.walkingMinutes === null, label + ".walkingMinutes 必须为 null。");
  } else {
    assert(Number.isInteger(restaurant.walkingMinutes)
      && restaurant.walkingMinutes >= 1 && restaurant.walkingMinutes <= 8,
      label + ".walkingMinutes 无效。");
  }
  assert(restaurant.dietaryNotice === null || isNonEmptyString(restaurant.dietaryNotice),
    label + ".dietaryNotice 无效。");
  assert(Array.isArray(restaurant.sourceUrls)
    && restaurant.sourceUrls.every(isNonEmptyString), label + ".sourceUrls 无效。");
}

export function validateViewModel(model) {
  assert(isObject(model), "view model 必须是对象。");
  assertExactKeys(model, [
    "selectedScope",
    "avoidPork",
    "today",
    "defaultRecordDate",
    "history",
    "restaurants",
    "managedRestaurants",
    "pendingNames",
    "sharedVerifiedAt",
    "currentRestaurant"
  ], "view model");
  assert(["primary", "secondary", "all"].includes(model.selectedScope), "view model.selectedScope 无效。");
  assert(typeof model.avoidPork === "boolean", "view model.avoidPork 必须是布尔值。");
  assert(isObject(model.today), "view model.today 必须是对象。");
  assertExactKeys(model.today, ["date", "isWeekday", "record"], "view model.today");
  assert(isNonEmptyString(model.today.date), "view model.today.date 必须是非空字符串。");
  assert(typeof model.today.isWeekday === "boolean", "view model.today.isWeekday 必须是布尔值。");
  assert(model.today.record === null || isObject(model.today.record), "view model.today.record 无效。");
  if (model.today.record !== null) {
    validateHistoryViewModel(model.today.record, "view model.today.record");
  }
  assert(isNonEmptyString(model.defaultRecordDate), "view model.defaultRecordDate 必须是非空字符串。");
  assert(Array.isArray(model.history), "view model.history 必须是数组。");
  model.history.forEach((record, index) => {
    validateHistoryViewModel(record, "view model.history[" + index + "]");
  });
  assert(Array.isArray(model.restaurants), "view model.restaurants 必须是数组。");
  model.restaurants.forEach((restaurant, index) => {
    validateRestaurantViewModel(restaurant, "view model.restaurants[" + index + "]");
  });
  assert(model.currentRestaurant === null || isObject(model.currentRestaurant),
    "view model.currentRestaurant 无效。");
  if (model.currentRestaurant !== null) {
    validateRestaurantViewModel(model.currentRestaurant, "view model.currentRestaurant");
  }
  assert(model.sharedVerifiedAt === null || typeof model.sharedVerifiedAt === "string",
    "view model.sharedVerifiedAt 无效。");
  assert(Array.isArray(model.managedRestaurants), "view model.managedRestaurants 无效。");
  model.managedRestaurants.forEach((restaurant) => {
    assertExactKeys(restaurant, ["id", "name", "scope", "location", "isPersonal", "isHidden"], "managedRestaurant");
    validateCandidate(restaurant);
    assert(typeof restaurant.isPersonal === "boolean" && typeof restaurant.isHidden === "boolean",
      "managedRestaurant 状态无效。");
  });
  assert(Array.isArray(model.pendingNames), "view model.pendingNames 无效。");
  model.pendingNames.forEach((pending) => {
    assertExactKeys(pending, ["name", "candidates", "historyCount"], "pendingName");
    assert(isNonEmptyString(pending.name) && Number.isInteger(pending.historyCount) && pending.historyCount >= 0,
      "pendingName 内容无效。");
    assert(Array.isArray(pending.candidates), "pendingName.candidates 无效。");
    pending.candidates.forEach(validateCandidate);
  });
  return model;
}

function validateCandidate(restaurant) {
  assert(isObject(restaurant) && [restaurant.id, restaurant.name, restaurant.location].every(isNonEmptyString)
    && ["primary", "secondary"].includes(restaurant.scope), "餐厅候选无效。");
}

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

function formatHeaderDate(dateKey) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(parseLocalDate(dateKey));
}

function formatHistoryDate(dateKey) {
  const date = parseLocalDate(dateKey);
  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(date),
    weekday: new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date)
  };
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

export function createView(dispatch) {
  assert(typeof dispatch === "function", "view 需要一个 dispatch 函数。");

  const elements = {};
  let viewModel = null;
  let editingDate = null;
  let guideScope = "all";
  let selectedRestaurantId = "";

  [
    "header-date",
    "draw-button",
    "draw-message",
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
    "result-dietary-notice",
    "confirm-button",
    "reroll-button",
    "history-list",
    "add-history-button",
    "history-count",
    "guide-catalog-summary",
    "restaurant-directory",
    "export-backup-button",
    "import-backup-input",
    "data-message",
    "record-dialog",
    "record-form",
    "record-dialog-title",
    "close-dialog-button",
    "cancel-dialog-button",
    "record-date",
    "record-restaurant",
    "record-candidates",
    "record-association",
    "unlink-record-button",
    "avoid-pork-input",
    "pending-names-input",
    "preview-names-button",
    "confirm-names-button",
    "pending-preview",
    "pending-list",
    "personal-form",
    "personal-name",
    "personal-scope",
    "personal-location",
    "personal-walk-field",
    "personal-walk",
    "personal-aliases",
    "managed-restaurants",
    "record-source",
    "restaurant-fields",
    "skip-field",
    "record-reason",
    "record-error",
    "delete-record-button"
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
  elements["header-date"].textContent = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date());

  function setMessage(element, message, isError = false) {
    element.textContent = message;
    element.style.color = isError ? "var(--danger)" : "";
  }

  function renderTodayStatus() {
    const { isWeekday, record } = viewModel.today;
    elements["manual-today-button"].disabled = !isWeekday;
    elements["skip-today-button"].disabled = !isWeekday;

    if (!isWeekday) {
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
      elements["today-status-title"].textContent = record.restaurantName;
      elements["today-status-badge"].textContent = "已记录";
      elements["today-status-badge"].className = "badge";
      elements["today-status-detail"].textContent = SOURCE_LABELS[record.source] || "餐厅午餐";
    } else {
      elements["today-status-title"].textContent = "今天跳过";
      elements["today-status-badge"].textContent = "不计冷却";
      elements["today-status-badge"].className = "badge badge-muted";
      elements["today-status-detail"].textContent = REASON_LABELS[record.reason] || record.reason || "未填写原因";
    }
  }

  function renderHistory() {
    const list = elements["history-list"];
    list.replaceChildren();
    const records = [...viewModel.history].sort((left, right) => right.date.localeCompare(left.date));

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
        detail.append(makeElement("h2", "", record.restaurantName));
        const source = SOURCE_LABELS[record.source] || "餐厅午餐";
        const weekendNote = record.isWeekday ? "" : " · 周末，不计冷却";
        detail.append(makeElement("p", "", source + (record.restaurantId ? "" : " · 未关联") + weekendNote));
      } else {
        detail.append(makeElement("h2", "", "跳过"));
        const reason = REASON_LABELS[record.reason] || record.reason || "未填写原因";
        const weekendNote = record.isWeekday ? "" : " · 周末，不计冷却";
        detail.append(makeElement("p", "", reason + weekendNote));
      }

      const editButton = makeElement("button", "button button-quiet", "修改");
      editButton.type = "button";
      editButton.addEventListener("click", () => openRecordDialog(record));
      item.append(date, detail, editButton);
      list.append(item);
    });
  }

  function createRestaurantDirectoryCard(restaurant) {
    const card = makeElement("article", "restaurant-directory-card");
    const heading = makeElement("div", "restaurant-directory-heading");
    const monogram = makeElement("span", "restaurant-monogram", restaurant.name.trim().charAt(0).toUpperCase());
    monogram.setAttribute("aria-hidden", "true");

    const titleGroup = makeElement("div", "restaurant-title-group");
    const badges = makeElement("div", "restaurant-badges");
    badges.append(makeElement("span", "badge", SCOPE_LABELS[restaurant.scope]));
    if (restaurant.pricePerPerson !== null) {
      badges.append(makeElement("span", "badge badge-muted", "参考 ¥" + restaurant.pricePerPerson + "/人"));
    }
    titleGroup.append(badges);
    titleGroup.append(makeElement("h3", "", restaurant.name));
    if (restaurant.cuisine) {
      titleGroup.append(makeElement("p", "restaurant-cuisine", restaurant.cuisine));
    }
    heading.append(monogram, titleGroup);

    const facts = makeElement("dl", "restaurant-directory-facts");
    const location = makeElement("div", "");
    location.append(makeElement("dt", "", "位置"));
    location.append(makeElement("dd", "", restaurant.location));
    facts.append(location);
    if (restaurant.scope === "secondary") {
      const walk = makeElement("div", "");
      walk.append(makeElement("dt", "", "步行"));
      walk.append(makeElement("dd", "", "约 " + restaurant.walkingMinutes + " 分钟（单程）"));
      facts.append(walk);
    }
    card.append(heading, facts);

    if (restaurant.dietaryNotice) {
      const porkFree = makeElement("p", "restaurant-pork-free");
      porkFree.append(makeElement("strong", "", "忌口提醒："));
      porkFree.append(document.createTextNode(restaurant.dietaryNotice));
      card.append(porkFree);
    }

    if (restaurant.sourceUrls.length > 0) {
      const actions = makeElement("div", "restaurant-directory-actions");
      const sourceLink = makeElement("a", "button button-quiet", "公开资料");
      sourceLink.href = restaurant.sourceUrls[0];
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      actions.append(sourceLink);
      card.append(actions);
    }
    return card;
  }

  function renderGuide() {
    const primaryCount = viewModel.restaurants.filter((restaurant) => restaurant.scope === "primary").length;
    const secondaryCount = viewModel.restaurants.filter((restaurant) => restaurant.scope === "secondary").length;
    const verifiedAt = viewModel.sharedVerifiedAt || "未标注";
    elements["guide-catalog-summary"].textContent = "当前可用目录共 " + viewModel.restaurants.length
      + " 家：楼下 " + primaryCount + " 家，附近 " + secondaryCount
      + " 家。共享目录核验日期：" + verifiedAt + "。";

    const directory = elements["restaurant-directory"];
    directory.replaceChildren();
    const visibleRestaurants = viewModel.restaurants.filter((restaurant) => (
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

  function runDataIntent(type, payload, message) {
    if (!viewModel) return false;
    try {
      applyResult(dispatch(createViewIntent(type, payload)));
      if (!viewModel.currentRestaurant) setMessage(elements["draw-message"], "");
      setMessage(elements["data-message"], message);
      return true;
    } catch (error) {
      render(viewModel);
      setMessage(elements["data-message"], "保存失败：" + error.message, true);
      return false;
    }
  }

  function renderPersonalData() {
    elements["avoid-pork-input"].checked = viewModel.avoidPork;
    const pendingList = elements["pending-list"];
    pendingList.replaceChildren();
    if (!viewModel.pendingNames.length) pendingList.append(makeElement("p", "", "没有待入库名称。"));
    viewModel.pendingNames.forEach((pending) => {
      const item = makeElement("article", "management-item");
      item.append(makeElement("strong", "", pending.name));
      item.append(makeElement("p", "", pending.historyCount + " 条未关联记录使用这个名称。"));
      pending.candidates.forEach((candidate) => {
        const button = makeElement("button", "button button-quiet candidate-button",
          "关联到 " + candidate.name + " · " + candidate.location);
        button.type = "button";
        button.addEventListener("click", () => {
          if (!window.confirm("将“" + pending.name + "”的 " + pending.historyCount
            + " 条未关联记录关联到“" + candidate.name + "”（" + candidate.location
            + "），保留原名称快照，并从待入库移除。是否继续？")) return;
          runDataIntent("resolvePending", { name: pending.name, restaurantId: candidate.id, confirmed: true }, "关联已保存。");
        });
        item.append(button);
      });
      const remove = makeElement("button", "button button-quiet", "移除待入库名称");
      remove.type = "button";
      remove.addEventListener("click", () => runDataIntent("removePendingName", { name: pending.name }, "已移除名称，午餐记录保持原样。"));
      item.append(remove);
      pendingList.append(item);
    });

    const managed = elements["managed-restaurants"];
    managed.replaceChildren();
    viewModel.managedRestaurants.forEach((restaurant) => {
      const item = makeElement("article", "management-item");
      item.append(makeElement("strong", "", restaurant.name));
      item.append(makeElement("p", "", (restaurant.isPersonal ? "个人新增" : "共享目录") + " · "
        + SCOPE_LABELS[restaurant.scope] + " · " + restaurant.location + (restaurant.isHidden ? " · 已隐藏" : "")));
      const button = makeElement("button", "button button-quiet", restaurant.isHidden ? "恢复到随机池" : "个人隐藏");
      button.type = "button";
      button.setAttribute("aria-label", button.textContent + "：" + restaurant.name);
      button.addEventListener("click", () => runDataIntent("setRestaurantHidden", {
        restaurantId: restaurant.id, hidden: !restaurant.isHidden
      }, restaurant.isHidden ? "餐厅已恢复。" : "已从本机随机池隐藏餐厅，历史仍保留。"));
      item.append(button);
      managed.append(item);
    });
  }

  function renderResult() {
    const restaurant = viewModel.currentRestaurant;
    if (!restaurant) {
      elements["result-section"].hidden = true;
      return;
    }

    const wasHidden = elements["result-section"].hidden;
    elements["result-scope"].textContent = SCOPE_LABELS[restaurant.scope];
    elements["result-scope"].className = "badge";
    elements["result-price"].hidden = restaurant.pricePerPerson === null;
    elements["result-price"].textContent = restaurant.pricePerPerson === null
      ? ""
      : "参考人均 ¥" + restaurant.pricePerPerson;
    elements["result-name"].textContent = restaurant.name;
    elements["result-cuisine"].hidden = !restaurant.cuisine;
    elements["result-cuisine"].textContent = restaurant.cuisine || "";
    elements["result-location"].textContent = restaurant.location;

    if (restaurant.scope === "secondary") {
      elements["result-walk-row"].hidden = false;
      elements["result-walk"].textContent = "约 " + restaurant.walkingMinutes + " 分钟（单程）";
    } else {
      elements["result-walk-row"].hidden = true;
      elements["result-walk"].textContent = "";
    }

    elements["confirm-button"].disabled = !viewModel.today.isWeekday;
    elements["confirm-button"].textContent = viewModel.today.isWeekday ? "就吃这家" : "周末不记录";
    elements["result-dietary-notice"].hidden = !restaurant.dietaryNotice;
    elements["result-dietary-notice"].textContent = restaurant.dietaryNotice
      ? "忌口提醒：" + restaurant.dietaryNotice
      : "";
    elements["result-section"].hidden = false;
    if (wasHidden) {
      elements["result-section"].scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function render(nextViewModel) {
    viewModel = validateViewModel(nextViewModel);
    elements["header-date"].textContent = formatHeaderDate(viewModel.today.date);
    const selectedScope = document.querySelector(
      'input[name="scope"][value="' + viewModel.selectedScope + '"]'
    );
    if (selectedScope) {
      selectedScope.checked = true;
    }
    renderTodayStatus();
    renderHistory();
    elements["history-count"].textContent = viewModel.history.length + " 条";
    renderGuide();
    renderResult();
    renderPersonalData();
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

  function renderRecordCandidates() {
    const list = elements["record-candidates"];
    list.replaceChildren();
    elements["record-association"].textContent = selectedRestaurantId
      ? "已关联餐厅；修改名称会取消关联。" : "未关联：按输入原文保存，选择下面的候选才会关联。";
    elements["unlink-record-button"].hidden = !selectedRestaurantId;
    if (selectedRestaurantId) return;
    const { candidates } = dispatch(createViewIntent("searchRestaurants", { text: elements["record-restaurant"].value }));
    candidates.forEach((restaurant) => {
      const button = makeElement("button", "button button-quiet candidate-button",
        restaurant.name + " · " + SCOPE_LABELS[restaurant.scope] + " · " + restaurant.location);
      button.type = "button";
      button.addEventListener("click", () => {
        selectedRestaurantId = restaurant.id;
        elements["record-restaurant"].value = restaurant.name;
        renderRecordCandidates();
      });
      list.append(button);
    });
  }

  function updateRecordFieldVisibility() {
    const status = document.querySelector('input[name="record-status"]:checked').value;
    const skipped = status === "skipped";
    elements["restaurant-fields"].hidden = skipped;
    elements["skip-field"].hidden = !skipped;
    elements["record-restaurant"].required = !skipped;
  }

  function openRecordDialog(record = null, preferredStatus = "restaurant") {
    if (!viewModel) {
      return;
    }
    editingDate = record ? record.date : null;
    elements["record-dialog-title"].textContent = record ? "修改午餐记录" : "补记午餐";
    elements["record-date"].value = record ? record.date : viewModel.defaultRecordDate;
    elements["record-date"].max = viewModel.today.date;
    elements["record-error"].textContent = "";
    elements["delete-record-button"].hidden = !record;

    selectedRestaurantId = "";
    elements["record-restaurant"].value = "";
    elements["record-source"].value = "manual";
    elements["record-reason"].value = "other";
    const status = record ? record.status : preferredStatus;
    const statusRadio = document.querySelector('input[name="record-status"][value="' + status + '"]');
    statusRadio.checked = true;

    if (record && record.status === "restaurant") {
      selectedRestaurantId = record.restaurantId || "";
      elements["record-restaurant"].value = record.restaurantName;
      elements["record-source"].value = record.source === "random" ? "manual" : record.source;
    } else if (record && record.status === "skipped" && record.reason) {
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
    renderRecordCandidates();
    elements["record-dialog"].showModal();
  }

  function closeRecordDialog() {
    editingDate = null;
    elements["record-dialog"].close();
  }

  function applyResult(result) {
    if (result && result.viewModel) {
      render(result.viewModel);
    }
    return result;
  }

  function handleScopeChange(input) {
    if (!viewModel || !input.checked) {
      return;
    }
    try {
      applyResult(dispatch(createViewIntent("changeScope", { scope: input.value })));
      setMessage(elements["draw-message"], "");
    } catch (error) {
      render(viewModel);
      setMessage(elements["draw-message"], "保存范围失败：" + error.message, true);
    }
  }

  function handleDraw(startNewSession) {
    if (!viewModel) {
      return;
    }
    try {
      const result = applyResult(dispatch(createViewIntent("draw", { startNewSession })));
      if (result.status === "exhausted") {
        setMessage(elements["draw-message"], "本轮候选已经用完。可以重新开始，或者切换范围。", true);
      } else {
        setMessage(elements["draw-message"], "本轮尚有 " + result.remaining
          + " 家未出现。只在确认后写入记录。");
      }
    } catch (error) {
      setMessage(elements["draw-message"], "抽取失败：" + error.message, true);
    }
  }

  function handleConfirmRestaurant() {
    if (!viewModel) {
      return;
    }
    try {
      let result = dispatch(createViewIntent("confirmRestaurant", { confirmed: false }));
      if (result.status === "confirmation_required") {
        if (!window.confirm("今天已有记录，是否用这家餐厅替换？")) {
          return;
        }
        result = dispatch(createViewIntent("confirmRestaurant", { confirmed: true }));
      }
      applyResult(result);
      if (result.status === "saved") {
        setMessage(elements["draw-message"], "已记录：" + result.restaurantName + "。祝你午餐愉快。");
      }
    } catch (error) {
      setMessage(elements["draw-message"], "保存失败：" + error.message, true);
    }
  }

  function saveRecordFromForm(event) {
    event.preventDefault();
    if (!viewModel) {
      return;
    }
    elements["record-error"].textContent = "";

    try {
      const status = document.querySelector('input[name="record-status"]:checked').value;
      const payload = {
        originalDate: editingDate,
        date: elements["record-date"].value,
        status,
        restaurantId: selectedRestaurantId,
        restaurantName: elements["record-restaurant"].value,
        source: elements["record-source"].value,
        reason: elements["record-reason"].value,
        confirmed: false
      };
      let result = dispatch(createViewIntent("saveRecord", payload));
      if (result.status === "confirmation_required") {
        if (!window.confirm("这个工作日已有记录，是否替换？")) {
          return;
        }
        result = dispatch(createViewIntent("saveRecord", { ...payload, confirmed: true }));
      }
      applyResult(result);
      closeRecordDialog();
      setMessage(elements["draw-message"], "");
      if (result.unlinkedName && window.confirm("午餐已保存为“" + result.unlinkedName
        + "”。是否把这个名称加入本地待入库？它不会参与随机，也不会自动提交。")) {
        runDataIntent("queueName", { name: result.unlinkedName }, "名称已加入本地待入库。");
        showView("data");
      }
    } catch (error) {
      elements["record-error"].textContent = error.message;
    }
  }

  function deleteEditingRecord() {
    if (!viewModel || !editingDate || !window.confirm("清除这一天的午餐记录？清除后将恢复为未记录。")) {
      return;
    }
    try {
      applyResult(dispatch(createViewIntent("deleteRecord", { date: editingDate })));
      closeRecordDialog();
      setMessage(elements["draw-message"], "");
    } catch (error) {
      elements["record-error"].textContent = error.message;
    }
  }

  async function handleImport(input) {
    if (!viewModel) {
      input.value = "";
      return;
    }
    setMessage(elements["data-message"], "");
    try {
      const document = await readJsonFile(input.files[0]);
      const preview = dispatch(createViewIntent("previewBackup", { document }));
      const message = "将用备份中的 " + preview.personalRestaurantCount + " 家个人餐厅、"
        + preview.hiddenSharedCount + " 条共享隐藏项、"
        + preview.pendingNameCount + " 个待入库名称和 "
        + preview.historyCount + " 条历史整体替换当前个人数据；部署版共享目录不会改变。是否继续？";
      if (!window.confirm(message)) {
        setMessage(elements["data-message"], "已取消导入，当前数据没有变化。");
        return;
      }
      applyResult(dispatch(createViewIntent("importBackup", { document })));
      clearPendingPreview();
      setMessage(elements["data-message"], "导入完成，个人数据已经替换。");
    } catch (error) {
      setMessage(elements["data-message"], "导入失败：" + error.message + " 当前数据没有变化。", true);
    } finally {
      input.value = "";
    }
  }

  document.querySelectorAll('input[name="scope"]').forEach((input) => {
    input.addEventListener("change", () => handleScopeChange(input));
  });
  elements["draw-button"].addEventListener("click", () => handleDraw(true));
  elements["reroll-button"].addEventListener("click", () => handleDraw(false));
  elements["confirm-button"].addEventListener("click", handleConfirmRestaurant);
  elements["manual-today-button"].addEventListener("click", () => openRecordDialog(null, "restaurant"));
  elements["skip-today-button"].addEventListener("click", () => openRecordDialog(null, "skipped"));
  elements["add-history-button"].addEventListener("click", () => openRecordDialog());

  document.querySelectorAll('input[name="record-status"]').forEach((input) => {
    input.addEventListener("change", updateRecordFieldVisibility);
  });
  elements["record-form"].addEventListener("submit", saveRecordFromForm);
  elements["record-restaurant"].addEventListener("input", () => {
    selectedRestaurantId = "";
    renderRecordCandidates();
  });
  elements["unlink-record-button"].addEventListener("click", () => {
    selectedRestaurantId = "";
    renderRecordCandidates();
  });
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
      if (viewModel) {
        renderGuide();
      }
    });
  });

  elements["export-backup-button"].addEventListener("click", () => {
    if (!viewModel) {
      return;
    }
    try {
      downloadJson("lunch-picker-backup.json", dispatch(createViewIntent("exportBackup")));
      setMessage(elements["data-message"], "个人备份已生成。");
    } catch (error) {
      setMessage(elements["data-message"], "导出失败：" + error.message, true);
    }
  });
  elements["import-backup-input"].addEventListener("change", () => {
    handleImport(elements["import-backup-input"]);
  });

  elements["avoid-pork-input"].addEventListener("change", () => {
    runDataIntent("setAvoidPork", { value: elements["avoid-pork-input"].checked }, "忌口偏好已保存。");
  });
  function clearPendingPreview() {
    elements["pending-preview"].replaceChildren();
    elements["confirm-names-button"].disabled = true;
  }
  elements["pending-names-input"].addEventListener("input", clearPendingPreview);
  elements["preview-names-button"].addEventListener("click", () => {
    if (!viewModel) return;
    clearPendingPreview();
    try {
      const preview = dispatch(createViewIntent("previewPendingNames", { text: elements["pending-names-input"].value }));
      elements["pending-preview"].append(makeElement("p", "", "清理后共 " + preview.names.length
        + " 个名称，其中 " + preview.existingCount + " 个已在待入库；确认后不会重复添加。"));
      const list = makeElement("ul");
      preview.names.forEach((name) => list.append(makeElement("li", "", name)));
      elements["pending-preview"].append(list);
      elements["confirm-names-button"].disabled = false;
    } catch (error) {
      setMessage(elements["data-message"], error.message, true);
    }
  });
  elements["confirm-names-button"].addEventListener("click", () => {
    if (runDataIntent("confirmPendingNames", {}, "名称已加入本地待入库，暂不参与随机。")) {
      elements["pending-names-input"].value = "";
      clearPendingPreview();
    }
  });
  function updatePersonalScope() {
    const secondary = elements["personal-scope"].value === "secondary";
    elements["personal-walk-field"].hidden = !secondary;
    elements["personal-walk"].required = secondary;
  }
  elements["personal-scope"].addEventListener("change", updatePersonalScope);
  elements["personal-form"].addEventListener("submit", (event) => {
    event.preventDefault();
    const scope = elements["personal-scope"].value;
    if (runDataIntent("addPersonalRestaurant", {
      name: elements["personal-name"].value, scope, location: elements["personal-location"].value,
      walkingMinutes: scope === "secondary" ? Number(elements["personal-walk"].value) : null,
      aliases: elements["personal-aliases"].value
    }, "个人餐厅已加入本机随机池。")) {
      elements["personal-form"].reset();
      updatePersonalScope();
    }
  });

  return {
    render,
    showInitialRoute() {
      showView(window.location.hash.replace("#", ""));
    },
    showLoadError(message) {
      [
        "draw-button",
        "reroll-button",
        "confirm-button",
        "manual-today-button",
        "skip-today-button",
        "add-history-button",
        "export-backup-button",
        "import-backup-input"
      ].forEach((id) => {
        elements[id].disabled = true;
      });
      document.querySelectorAll('input[name="scope"]').forEach((input) => {
        input.disabled = true;
      });
      setMessage(elements["draw-message"], message, true);
    }
  };
}
