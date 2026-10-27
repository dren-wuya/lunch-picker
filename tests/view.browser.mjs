import { createView } from "../js/view.mjs";

// Run through view.browser.html on the local HTTP server. No personal data is read or written.
const passed = [];
const element = (id) => document.getElementById(id);
const check = (name, condition) => {
  if (!condition) throw new Error(name);
  passed.push(name);
};
async function waitFor(condition) {
  const deadline = performance.now() + 2000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error("等待界面状态超时。");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const editButton = () => element("history-list").querySelector("button");
function openEdit() {
  const button = editButton();
  button.focus();
  button.click();
  return button;
}
async function answerConfirmation(value) {
  await waitFor(() => element("action-dialog").open);
  const button = element("action-dialog").querySelector('button[value="' + value + '"]');
  element("action-dialog").querySelector("form").requestSubmit(button);
  await waitFor(() => !element("action-dialog").open);
  // The close event resolves the view's confirmation promise asynchronously.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

try {
  const response = await fetch(new URL("../index.html", import.meta.url));
  if (!response.ok) throw new Error("无法读取页面测试夹具。");
  const fixture = new DOMParser().parseFromString(await response.text(), "text/html");
  fixture.querySelectorAll("script").forEach((script) => script.remove());
  document.body.replaceChildren(...[...fixture.body.childNodes].map((node) => document.importNode(node, true)));

  const headerDate = element("header-date");
  headerDate.remove();
  let missingElementError = "";
  try { createView(() => {}); } catch (error) { missingElementError = error.message; }
  document.querySelector(".site-header").append(headerDate);
  check("缺少必需 DOM 时明确报错", missingElementError.includes("#header-date"));

  const restaurants = ["甲", "乙", "丙"].map((name, index) => ({
    id: String(index), name: "测试" + name + "店", scope: "primary", location: "LG0" + index,
    cuisine: null, pricePerPerson: null, walkingMinutes: null, dietaryNotice: null, sourceUrls: []
  }));
  const model = {
    selectedScope: "primary", avoidPork: false,
    today: { date: "2026-10-26", isWeekday: true, record: null },
    defaultRecordDate: "2026-10-26", sharedVerifiedAt: null, currentRestaurant: null,
    restaurants, pendingNames: [],
    managedRestaurants: restaurants.map(({ id, name, scope, location }) => ({
      id, name, scope, location, isPersonal: false, isHidden: false
    })),
    history: [{ date: "2026-10-23", status: "restaurant", restaurantId: "0",
      restaurantName: "测试甲店", source: "manual", reason: null, isWeekday: true }]
  };
  // Controlled controller responses keep these tests about DOM behavior, without booting
  // app.mjs (which starts the real application and reads browser storage on import).
  let drawIndex = 0;
  const view = createView((intent) => {
    switch (intent.type) {
      case "searchRestaurants": return { candidates: [] };
      case "saveRecord":
        model.history = [{ ...model.history[0], date: intent.date }];
        return { status: "saved", viewModel: model };
      case "deleteRecord": model.history = []; break;
      case "setAvoidPork": model.avoidPork = intent.value; break;
      case "draw":
        if (intent.startNewSession) drawIndex = 0;
        model.currentRestaurant = restaurants[drawIndex++] || null;
        return { status: model.currentRestaurant ? "drawn" : "exhausted",
          remaining: Math.max(0, restaurants.length - drawIndex), viewModel: model };
      default: throw new Error("意外的测试意图：" + intent.type);
    }
    return { viewModel: model };
  });
  view.render(model);
  view.showInitialRoute();
  check("初次加载不抢焦点", document.activeElement === document.body);

  document.querySelector('[data-view="history"]').click();
  check("导航聚焦目标标题", document.activeElement === element("history-title"));
  check("标题可编程聚焦且不加入 Tab 顺序", element("history-title").tabIndex === -1);
  check("历史修改按钮包含日期", editButton().getAttribute("aria-label").includes("2026-10-23"));

  const opener = openEdit();
  check("餐厅记录打开后聚焦名称", document.activeElement === element("record-restaurant"));
  element("cancel-dialog-button").click();
  check("取消后返回原按钮", document.activeElement === opener);
  openEdit();
  const cancel = new Event("cancel", { cancelable: true });
  element("record-dialog").dispatchEvent(cancel);
  check("原生取消路径关闭弹窗并恢复焦点", cancel.defaultPrevented
    && !element("record-dialog").open && document.activeElement === opener);

  openEdit();
  element("record-form").requestSubmit();
  await waitFor(() => !element("record-dialog").open);
  check("保存后聚焦重绘后的修改按钮", !opener.isConnected && document.activeElement === editButton());

  openEdit();
  element("record-date").value = "2026-10-22";
  element("record-form").requestSubmit();
  await waitFor(() => !element("record-dialog").open);
  check("记录改期后聚焦补记入口", document.activeElement === element("add-history-button"));

  openEdit();
  element("delete-record-button").focus();
  element("delete-record-button").click();
  await answerConfirmation("cancel");
  check("取消嵌套确认后仍在编辑弹窗", element("record-dialog").open
    && document.activeElement === element("delete-record-button"));
  element("delete-record-button").click();
  await answerConfirmation("confirm");
  await waitFor(() => !element("record-dialog").open);
  check("删除后聚焦补记入口", !editButton() && document.activeElement === element("add-history-button"));

  document.querySelector('[data-view="today"]').click();
  element("skip-today-button").focus();
  element("skip-today-button").click();
  check("跳过记录聚焦日期", document.activeElement === element("record-date"));
  element("close-dialog-button").click();
  check("关闭按钮恢复焦点", document.activeElement === element("skip-today-button"));
  element("draw-button").click();
  const firstPick = element("result-name").textContent;
  check("首次抽签在持续存在的状态区播报店名", !element("result-section").hidden
    && element("draw-message").textContent.includes(firstPick)
    && element("draw-message").getAttribute("role") === "status");
  element("reroll-button").click();
  check("换一家同步更新播报", element("result-name").textContent !== firstPick
    && element("draw-message").textContent.includes(element("result-name").textContent));
  element("reroll-button").click();
  element("reroll-button").click();
  check("耗尽提示保留错误样式", element("draw-message").classList.contains("is-error"));
  element("draw-button").click();
  check("重新抽签清除错误样式", !element("draw-message").classList.contains("is-error"));

  document.querySelector('[data-view="data"]').click();
  element("avoid-pork-input").click();
  check("个人数据操作由简短状态区播报", element("data-message").textContent === "忌口偏好已保存。"
    && element("data-message").getAttribute("role") === "status");
  check("重绘列表和结果卡不整块重复播报", ["pending-list", "managed-restaurants", "result-section"]
    .every((id) => !element(id).hasAttribute("aria-live")));
  check("导入名称包含可见标签", element("import-backup-input").getAttribute("aria-label").includes("导入个人备份"));
  check("跳转链接有可聚焦的主内容目标", document.querySelector(".skip-link").getAttribute("href") === "#main-content"
    && element("main-content").tabIndex === -1);

  window.viewTestResult = { passed: passed.length, failed: 0 };
} catch (error) {
  window.viewTestResult = { passed: passed.length, failed: 1, error: error.stack };
}
const report = document.createElement("pre");
report.id = "test-results";
report.textContent = JSON.stringify(window.viewTestResult, null, 2) + "\n" + passed.join("\n");
document.body.prepend(report);
document.title = window.viewTestResult.failed ? "FAIL: View regression tests" : "PASS: View regression tests";
