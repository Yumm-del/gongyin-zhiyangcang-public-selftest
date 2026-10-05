/* 新版概念演示的关键路径回归：本文件只验证浏览器交互，不连接银行系统。 */
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const fileUrl = pathToFileURL(path.resolve(__dirname, "..", "demo2.html")).href;
  await page.goto(fileUrl);

  // 税额引擎必须复用旧版 engine.js，并继续通过既有算例。
  assert.deepEqual(await page.evaluate(() => ENGINE.selfTest()), []);
  assert.match(await page.locator("h1").innerText(), /服务使谁发生缴存/);

  // U103 入组后撤回许可：消息禁止发送，但最初分组和 N1 分母仍保留。
  await page.getByRole("button", { name: /客户与触达回放/ }).click();
  await page.getByRole("button", { name: /U103/ }).click();
  await page.getByRole("button", { name: "客户撤回渠道许可" }).click();
  assert.match(await page.locator("#caseDetail").innerText(), /N1 已入组/);
  assert.match(await page.locator("#caseDetail").innerText(), /仍留在最初随机臂/);
  assert.equal(await page.getByRole("button", { name: "模拟发送经许可消息" }).isDisabled(), true);

  // 转入账户不得进入定向池，也不得以营销名义索取服务输入。
  await page.getByRole("button", { name: /U105/ }).click();
  assert.match(await page.locator("#caseDetail").innerText(), /不在 N1/);
  await page.getByRole("button", { name: /客户服务判断/ }).click();
  assert.equal(await page.locator("#evaluate").isDisabled(), true);

  // 必要支出触发暂缓；清空页面不能撤销已经生效的停止状态。
  await page.getByRole("button", { name: /客户与触达回放/ }).click();
  await page.getByRole("button", { name: /U104/ }).click();
  await page.getByRole("button", { name: /客户服务判断/ }).click();
  await page.getByRole("button", { name: "生成服务判断" }).click();
  assert.match(await page.locator("#serviceResult").innerText(), /暂缓本次促缴/);
  await page.getByRole("button", { name: "清空本次判断" }).click();
  assert.equal(await page.getByRole("button", { name: "生成服务判断" }).isDisabled(), true);

  // T0=42,000元、拟缴12,000元时，逐档税额差为780元，简化算法高估420元。
  await page.getByRole("button", { name: /客户与触达回放/ }).click();
  await page.getByRole("button", { name: /U102/ }).click();
  await page.getByRole("button", { name: /客户服务判断/ }).click();
  await page.getByRole("button", { name: "生成服务判断" }).click();
  const result = await page.locator("#serviceResult").innerText();
  assert.match(result, /780 元/);
  assert.match(result, /420 元/);
  await page.getByRole("button", { name: "模拟正式账务首缴回传" }).click();
  await page.getByRole("button", { name: /客户与触达回放/ }).click();
  assert.match(await page.locator("#caseDetail").innerText(), /移出未首缴定向池/);

  // 试验页必须把 T−B 的区间跨零解释为不能直接扩张。
  await page.getByRole("button", { name: /增量评价/ }).click();
  assert.match(await page.locator("#comparisons").innerText(), /区间跨零/);
  assert.match(await page.locator("#score").innerText(), /全部50,000名最初入组客户/);
  assert.deepEqual(errors, []);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.resolve(__dirname, "..", "demo2-mobile-qa.png"), fullPage: true });
  await browser.close();
  console.log("demo2 browser checks: PASS");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
