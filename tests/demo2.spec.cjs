/* 六屏Alpha与辅助演示验收：只访问本地虚构案例，不连接银行系统。 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const qaDir = path.resolve(__dirname, "..", "..", "tmp", "demo2-alpha-qa");
    fs.mkdirSync(qaDir, { recursive: true });
    await page.goto(pathToFileURL(path.resolve(__dirname, "..", "demo2.html")).href);
    const screen = number => page.locator(`.alpha-stage[data-screen="${number}"]`);
    const action = name => page.locator(`[data-alpha="${name}"]`).filter({ visible: true });
    async function shot(name) {
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(qaDir, name + ".png"), fullPage: true });
    }
    async function choose(id) {
      await page.getByRole("button", { name: "六屏 Alpha · 主演示", exact: true }).click();
      await page.locator("#alphaCase").selectOption(id);
    }
    async function startTax() {
      await action("start").click();
      await page.locator('[data-alpha-barrier="tax"]').click();
      await action("barrier-next").click();
    }

    // 主入口六屏按顺序解锁；税额规则复用原引擎。
    assert.equal(await screen(1).isVisible(), true);
    assert.equal(await page.locator("[data-alpha-screen='6']").isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => ENGINE.selfTest()), []);
    await shot("screen-1");
    await action("start").click();
    await shot("screen-2");
    await action("barrier-next").click();
    await shot("screen-3");
    await page.locator("#deposit").fill("13000");
    await page.locator("#evaluate").click();
    assert.equal(await screen(3).isVisible(), true);
    assert.match(await page.locator("#alphaError").innerText(), /检查金额/);
    await page.locator("#deposit").fill("12000");
    await page.locator("#evaluate").click();
    assert.equal(await screen(4).isVisible(), true);
    assert.match(await page.locator("#serviceResult").innerText(), /780 元/);
    assert.match(await page.locator("#serviceResult").innerText(), /420 元/);
    await shot("screen-4");
    await action("result-next").click();
    await shot("screen-5");
    await action("continue").click();
    assert.equal(await screen(6).isVisible(), true);
    assert.match(await page.locator("#alphaTask").innerText(), /ALLOW_SELF_SERVICE/);
    assert.doesNotMatch(await page.locator("#alphaTask").innerText(), /42000|42,000|780 元|6个月/);
    assert.equal(await page.evaluate(() => state.ledger), false);
    await shot("screen-6");

    // 客户主动降额返回必要信息页，必须重新计算。
    await page.locator('[data-alpha-screen="5"]').click();
    await action("less").click();
    assert.equal(await screen(3).isVisible(), true);
    assert.equal(await page.locator("#deposit").inputValue(), "6000");
    assert.equal(await page.locator('[data-alpha-screen="6"]').isDisabled(), true);
    await page.locator("#evaluate").click();
    await action("result-next").click();
    await action("continue").click();
    assert.match(await page.locator("#alphaTask").innerText(), /CUSTOMER_LOWER_AMOUNT/);

    // 仅查看步骤不需要敏感输入；人工路径也可不填写T0。
    await choose("U102");
    await action("start").click();
    await page.locator('[data-alpha-barrier="steps"]').click();
    await action("barrier-next").click();
    assert.equal(await screen(3).isVisible(), false);
    assert.match(await page.locator("#serviceResult").innerText(), /不需要提供T0/);
    assert.equal(await page.evaluate(() => state.alphaAudit.some(x => x.inputs)), false);
    await choose("U102");
    await action("start").click();
    await page.locator('[data-alpha-barrier="complex"]').click();
    await action("barrier-next").click();
    await action("result-next").click();
    assert.equal(await action("continue").isDisabled(), true);
    await action("human").click();
    assert.match(await page.locator("#alphaTask").innerText(), /HUMAN_REQUEST/);

    // 正税差不能覆盖必要支出；停止后不允许通过降额继续促缴。
    await choose("U104");
    await startTax();
    await page.locator("#evaluate").click();
    assert.match(await page.locator("#serviceResult").innerText(), /暂缓本次促缴/);
    assert.match(await page.locator("#serviceResult").innerText(), /780 元/);
    await action("result-next").click();
    assert.equal(await action("continue").isDisabled(), true);
    assert.equal(await action("less").isDisabled(), true);
    await action("pause").click();
    assert.match(await page.locator("#alphaTask").innerText(), /SERVICE_PAUSED/);

    // 判断中撤回许可：原分组保留，未来发送被抑制；证据可本地下载。
    await choose("U103");
    await startTax();
    await page.locator("#evaluate").click();
    await action("revoke").click();
    await action("result-next").click();
    await action("human").click();
    assert.match(await page.locator("#alphaTask").innerText(), /CHANNEL_REVOKED/);
    assert.equal(await page.evaluate(() => eligibility(currentCase()).n1), true);
    assert.equal(await page.evaluate(() => eligibility(currentCase()).maySend), false);
    const downloadPromise = page.waitForEvent("download");
    await screen(6).locator('[data-alpha="export"]').click();
    const download = await downloadPromise;
    const evidence = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    assert.equal(evidence.realLedgerConnected, false);
    assert.equal(evidence.originalArm, "T");
    assert.ok(evidence.alphaPath.some(x => x.inputs && x.output));
    assert.ok(evidence.alphaPath.some(x => x.action === "撤回渠道许可"));

    await action("close").click();
    assert.equal(await page.locator("#alphaClosed").isVisible(), true);
    await action("restart").click();
    assert.equal(await screen(1).isVisible(), true);
    await choose("U105");
    assert.equal(await action("start").isDisabled(), true);

    // 辅助A/B/T界面保留：提交不等于送达；单人操作不改变汇总分母。
    await page.getByRole("button", { name: "辅助 · 三臂方案", exact: true }).click();
    await page.getByRole("button", { name: "体验 T 组页面", exact: true }).click();
    await page.getByRole("button", { name: "模拟提交获准消息", exact: true }).click();
    assert.equal(await page.locator(".phone-message").count(), 0);
    await page.getByRole("button", { name: "模拟消息送达", exact: true }).click();
    assert.equal(await page.locator(".phone-message").count(), 1);
    await page.getByRole("button", { name: "辅助 · 增量评价", exact: true }).click();
    assert.match(await page.locator("#comparisons").innerText(), /区间跨零/);
    assert.match(await page.locator("#score").innerText(), /全部50,000名最初入组客户/);

    // 手机端必要信息与原因码任务卡均无横向溢出。
    await choose("U102");
    await startTax();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot("mobile-screen-3");
    await page.locator("#evaluate").click();
    await action("result-next").click();
    await action("continue").click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot("mobile-screen-6");
    assert.deepEqual(errors, []);
    console.log("six-screen Alpha and auxiliary checks: PASS");
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
