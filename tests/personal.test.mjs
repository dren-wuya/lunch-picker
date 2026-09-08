import assert from "node:assert/strict";
import test from "node:test";
import { createController } from "../js/app.mjs";
import { createInitialState, getCooldownRestaurantIds, parseRestaurantNames } from "../js/core.mjs";
import { validateViewModel } from "../js/view.mjs";

const shared = { schema_version: 1, type: "restaurants", restaurants: [
  { id: "a", name: "甲面馆", aliases: ["ＡＢＣ", "面店"], scope: "primary", location: "LG01" },
  { id: "b", name: "乙面馆", aliases: ["abc", "面店"], scope: "primary", location: "LG02" }
] };
function createApp(state = createInitialState(), document = shared) {
  const storage = { value: JSON.stringify(state), fail: false,
    setItem(key, value) { if (this.fail) throw new Error("storage full"); this.value = value; } };
  let nextId = 0;
  const app = createController(document, state, { storage, today: () => "2026-09-07", random: () => 0,
    makePersonalId: () => "personal-" + (++nextId) });
  return { ...app, storage };
}
function save(app, fields = {}) {
  return app.dispatch({ type: "saveRecord", originalDate: null, date: "2026-09-04", status: "restaurant",
    restaurantId: "", restaurantName: "自由文本", source: "manual", reason: "other", confirmed: false, ...fields });
}

test("名称只作简单包含匹配：多个别名命中同时展示，不自动关联或入池", () => {
  const app = createApp();
  assert.deepEqual(app.dispatch({ type: "searchRestaurants", text: "ａBc" }).candidates.map((r) => r.id), ["a", "b"]);
  assert.equal(app.dispatch({ type: "searchRestaurants", text: "甲麵館" }).candidates.length, 0);
  save(app, { restaurantName: "  abc  " });
  let backup = app.dispatch({ type: "exportBackup" });
  assert.equal(backup.history[0].restaurant_id, null);
  assert.equal(backup.history[0].restaurant_name, "  abc  ");
  assert.deepEqual(backup.pending_restaurant_names, []);
  assert.equal(app.getViewModel().restaurants.length, 2);
  save(app, { originalDate: "2026-09-04", restaurantId: "b", restaurantName: "乙面馆" });
  backup = app.dispatch({ type: "exportBackup" });
  assert.deepEqual([...getCooldownRestaurantIds(backup.history, "2026-09-07")], ["b"]);
  assert.equal(backup.history.length, 1);
});

test("批量名称预览后才保存，精确去重且不进入随机池", () => {
  assert.deepEqual(parseRestaurantNames(" 甲，乙,甲\r\n乙\nＡ, A "), ["甲", "乙", "Ａ", "A"]);
  const app = createApp();
  assert.throws(() => app.dispatch({ type: "confirmPendingNames" }), /先预览/);
  const before = app.storage.value;
  assert.deepEqual(app.dispatch({ type: "previewPendingNames", text: "面店, 面店，另一家\n" }),
    { names: ["面店", "另一家"], existingCount: 0 });
  assert.equal(app.storage.value, before);
  app.dispatch({ type: "confirmPendingNames" });
  app.dispatch({ type: "queueName", name: " 面店 " });
  assert.deepEqual(app.dispatch({ type: "exportBackup" }).pending_restaurant_names, ["面店", "另一家"]);
  assert.equal(app.getViewModel().restaurants.length, 2);
  validateViewModel(app.getViewModel());
});

test("目录更新只提供待入库候选，确认后才关联相同原文的历史且保留快照", () => {
  const first = createApp();
  save(first, { restaurantName: "新店简称" });
  first.dispatch({ type: "queueName", name: "新店简称" });
  const state = JSON.parse(first.storage.value);
  const updated = structuredClone(shared);
  updated.restaurants[1].aliases.push("新店简称");
  const app = createApp(state, updated);
  assert.equal(app.getViewModel().history[0].restaurantId, null);
  assert.equal(app.getViewModel().pendingNames[0].candidates[0].id, "b");
  const intent = { type: "resolvePending", name: "新店简称", restaurantId: "b", confirmed: false };
  assert.deepEqual(app.dispatch(intent), { status: "confirmation_required", historyCount: 1 });
  assert.equal(app.getViewModel().history[0].restaurantId, null);
  assert.throws(() => app.dispatch({ ...intent, restaurantId: "a", confirmed: true }), /当前候选/);
  app.dispatch({ ...intent, confirmed: true });
  assert.equal(app.getViewModel().history[0].restaurantId, "b");
  assert.equal(app.getViewModel().history[0].restaurantName, "新店简称");
  assert.equal(app.getViewModel().pendingNames.length, 0);
});

test("未关联午餐消耗一顿冷却但不让任何餐厅进入冷却；跳过仍不消耗", () => {
  const history = [
    { date: "2026-09-02", status: "restaurant", restaurant_id: "a" },
    { date: "2026-09-03", status: "restaurant", restaurant_id: null },
    { date: "2026-09-04", status: "skipped" }
  ];
  assert.deepEqual([...getCooldownRestaurantIds(history, "2026-09-07")], ["a"]);
  history[2] = { ...history[2], status: "restaurant", restaurant_id: null };
  assert.deepEqual([...getCooldownRestaurantIds(history, "2026-09-07")], []);
});

test("编辑已移出目录的记录保留旧关联和快照；取消关联后保存自由文字", () => {
  const app = createApp({ ...createInitialState(), history: [
    { date: "2026-09-04", status: "restaurant", restaurant_id: "removed", restaurant_name: "旧店名", source: "manual" }
  ] });
  save(app, { originalDate: "2026-09-04", date: "2026-09-03", restaurantId: "removed", restaurantName: "旧店名" });
  assert.equal(app.getViewModel().history[0].restaurantId, "removed");
  assert.equal(app.getViewModel().history.length, 1);
  save(app, { originalDate: "2026-09-03", date: "2026-09-03", restaurantName: "新原文" });
  assert.equal(app.getViewModel().history[0].restaurantId, null);
  assert.equal(app.getViewModel().history[0].restaurantName, "新原文");
});

test("个人新增校验位置和步行范围，隐藏与恢复保留历史，备份包含完整叠加层", () => {
  const app = createApp();
  const intent = { type: "addPersonalRestaurant", name: "个人店", scope: "secondary", location: "商城路1号",
    walkingMinutes: 9, aliases: " 个店,个店，个人 " };
  assert.throws(() => app.dispatch(intent), /1–8 分钟/);
  assert.throws(() => app.dispatch({ ...intent, location: "" }), /文字位置/);
  app.dispatch({ ...intent, walkingMinutes: 8 });
  const restaurant = app.getViewModel().managedRestaurants.find((r) => r.isPersonal);
  assert.ok(restaurant.id.startsWith("personal-"));
  save(app, { restaurantId: "a", restaurantName: "甲面馆" });
  app.dispatch({ type: "draw", startNewSession: true });
  for (const id of ["a", restaurant.id]) app.dispatch({ type: "setRestaurantHidden", restaurantId: id, hidden: true });
  assert.equal(app.getViewModel().currentRestaurant, null);
  assert.deepEqual(app.getViewModel().restaurants.map((r) => r.id), ["b"]);
  assert.equal(app.getViewModel().history[0].restaurantId, "a");
  const backup = app.dispatch({ type: "exportBackup" });
  assert.deepEqual(backup.personal_restaurants[0].aliases, ["个店", "个人"]);
  const restored = createApp();
  restored.dispatch({ type: "importBackup", document: backup });
  assert.deepEqual(restored.getViewModel(), app.getViewModel());
  for (const id of ["a", restaurant.id]) restored.dispatch({ type: "setRestaurantHidden", restaurantId: id, hidden: false });
  assert.equal(restored.getViewModel().restaurants.length, 3);
});

test("个人管理写入失败保持内存和磁盘；忌口开关保持当前抽签与候选池", () => {
  const app = createApp();
  app.dispatch({ type: "draw", startNewSession: true });
  const before = app.getViewModel();
  const diskBefore = app.storage.value;
  app.storage.fail = true;
  for (const intent of [
    { type: "setRestaurantHidden", restaurantId: "a", hidden: true },
    { type: "queueName", name: "新店" },
    { type: "setAvoidPork", value: true }
  ]) assert.throws(() => app.dispatch(intent), /storage full/);
  assert.deepEqual(app.getViewModel(), before);
  assert.equal(app.storage.value, diskBefore);
  app.storage.fail = false;
  app.dispatch({ type: "setAvoidPork", value: true });
  assert.equal(app.getViewModel().currentRestaurant.id, before.currentRestaurant.id);
  assert.deepEqual(app.getViewModel().restaurants.map((r) => r.id), before.restaurants.map((r) => r.id));
  assert.match(app.getViewModel().currentRestaurant.dietaryNotice, /尚未核实/);
});

test("隐藏只影响随机池，仍可手动关联餐厅，记录不会自动恢复隐藏项", () => {
  const app = createApp();
  app.dispatch({ type: "setRestaurantHidden", restaurantId: "a", hidden: true });
  assert.equal(app.dispatch({ type: "searchRestaurants", text: "甲面馆" }).candidates[0].id, "a");
  save(app, { restaurantId: "a", restaurantName: "甲面馆" });
  assert.equal(app.getViewModel().history[0].restaurantId, "a");
  assert.deepEqual(app.getViewModel().restaurants.map((r) => r.id), ["b"]);
});
