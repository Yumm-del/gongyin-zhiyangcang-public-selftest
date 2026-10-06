/* 六屏Alpha与辅助演示验收：只访问本地虚构案例，不连接银行系统。 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

async function main() {
  const startedAt = new Date().toISOString();
  const firstScreenChecks = [];
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
    assert.equal(await page.locator('#management').isVisible(), true);
    assert.equal(await page.locator('#alpha').isVisible(), false);
    // 使用真实首屏截图而非整页截图，确认最小桌面视口无需滚动即可进入服务。
    for (const viewport of [{width:1360,height:900},{width:1280,height:720}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0,0));
      await page.waitForTimeout(350);
      for (const id of ['managementService','managementScore']) {
        const box = await page.locator('#'+id).boundingBox();
        firstScreenChecks.push({viewport,entry:id,button:box});
        assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, `经营总览入口应完整位于${viewport.width}×${viewport.height}首屏`);
      }
      await page.screenshot({path:path.join(qaDir,`first-screen-${viewport.width}.png`),fullPage:false});
    }
    await page.setViewportSize({width:1360,height:900});
    await page.locator('#managementScore').click();
    assert.equal(await page.locator('#score').isVisible(), true);
    await page.getByRole('button',{name:'银行经营总览',exact:true}).click();
    await page.locator('#managementService').click();
    assert.equal(await screen(1).isVisible(), true);
    assert.doesNotMatch(await screen(1).locator('.phone').innerText(), /第1屏|界面示意/);
    async function shot(name) {
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(qaDir, name + ".png"), fullPage: true });
    }
    async function choose(id) {
      await page.getByRole("button", { name: "客户服务 · 六屏 Alpha", exact: true }).click();
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
    assert.match(await page.locator('#alphaTask').innerText(), /银行侧承接视图/);
    await screen(6).getByRole("button", {name:"查看服务增量怎样测量 →",exact:true}).click();
    assert.equal(await page.locator("#score").isVisible(), true);
    await page.getByRole("button",{name:"客户服务 · 六屏 Alpha",exact:true}).click();

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
    await page.getByRole("button", { name: "体验 A 组页面", exact: true }).click();
    await page.getByRole("button",{name:"客户服务 · 六屏 Alpha",exact:true}).click();
    assert.equal(await action("start").isDisabled(), true);
    assert.match(await screen(1).innerText(), /A组维持现有服务/);
    await choose("U102");
    assert.equal(await page.locator('#alphaCase option[data-temporary]').count(), 0);
    await page.getByRole("button", { name: "辅助 · 三臂方案", exact: true }).click();
    await page.getByRole("button", { name: "体验 T 组页面", exact: true }).click();
    await page.getByRole("button", { name: "模拟提交获准消息", exact: true }).click();
    assert.equal(await page.locator(".phone-message").count(), 0);
    await page.getByRole("button", { name: "模拟消息送达", exact: true }).click();
    assert.equal(await page.locator(".phone-message").count(), 1);
    await page.getByRole("button", { name: "辅助 · 增量评价", exact: true }).click();
    assert.match(await page.locator("#comparisons").innerText(), /区间跨零/);
    assert.match(await page.locator("#score").innerText(), /各组50,000名最初入组客户/);
    assert.match(await page.locator("#score").innerText(), /共150,000人/);
    assert.equal(await page.locator('#scoreCards').getByText('共同刻度上限 2%',{exact:true}).count(), 3);

    // 资金顾虑不自动暂停：无必要支出占用且缴后缓冲足够，可自主选择；不需要税额输入。
    await choose("U102");
    await action("start").click();
    await page.locator('[data-alpha-barrier="liquidity"]').click();
    await action("barrier-next").click();
    assert.equal(await page.locator("#alphaTaxField").isVisible(), false);
    assert.equal(await page.locator("#alphaDepositField").isVisible(), true);
    await page.locator("#reserve").fill("");
    await page.locator("#evaluate").click();
    assert.equal(await screen(3).isVisible(), true);
    await page.locator("#reserve").fill("6");
    await page.locator("#evaluate").click();
    assert.equal(await page.evaluate(() => state.outcome.kind), "continue");
    assert.equal(await page.evaluate(() => state.outcome.tax), null);
    await action("result-next").click();
    assert.equal(await action("continue").isDisabled(), false);

    // 拟缴资金明确涉及必要支出，足够的其他缓冲也不覆盖该停止条件。
    await choose("U102");
    await startTax();
    await page.locator("#urgent").check();
    await page.locator("#evaluate").click();
    assert.equal(await page.evaluate(() => state.outcome.kind), "pause");
    await action("result-next").click();
    assert.equal(await action("continue").isDisabled(), true);
    assert.equal(await action("less").isDisabled(), true);

    // 范围与财务卡保持独立展示，切换成本不会修改模拟试验样本。
    await page.getByRole("button", { name: "辅助 · 三臂方案", exact: true }).click();
    assert.match(await page.locator("#scopeCards").innerText(), /完整六屏不直接算作首期处理/);
    await shot("scope-overview");
    await page.getByRole("button", { name: "辅助 · 增量评价", exact: true }).click();
    for (const [category, phrase] of [["channel","账单"],["human","分钟数"],["run","运维"],["build","摊销期"]]) {
      await page.locator(`[data-cost="${category}"]`).click();
      assert.match(await page.locator("#costDetail").innerText(), new RegExp(phrase));
      assert.equal(await page.locator(`[data-cost="${category}"]`).getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator('[data-cost][aria-pressed="true"]').count(), 1);
    }
    assert.equal(await page.evaluate(() => TRIAL.map(x => x.n).join(",")), "50000,50000,50000");
    await shot("increment-and-finance");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot("mobile-finance");
    await page.setViewportSize({ width: 1360, height: 900 });

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
    await page.getByRole('button',{name:'银行经营总览',exact:true}).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot('mobile-management');
    // 检查记录绑定提交和文件指纹，避免把旧版检查结果用于新版。
    const repository = path.resolve(__dirname,"..");
    const hashes = Object.fromEntries(["demo2.html","engine.js","tests/demo2.spec.cjs"].map(file=>[file,crypto.createHash("sha256").update(fs.readFileSync(path.join(repository,file))).digest("hex")]));
    const verification = {startedAt,finishedAt:new Date().toISOString(),commit:execFileSync("git",["rev-parse","HEAD"],{cwd:repository,encoding:"utf8"}).trim(),worktree:execFileSync("git",["status","--porcelain"],{cwd:repository,encoding:"utf8"}).trim(),demoVersion:await page.evaluate(()=>DEMO_VERSION),ruleVersion:await page.evaluate(()=>RULE_VERSION),node:process.version,playwright:require("playwright/package.json").version,browser:browser.version(),fileSHA256:hashes,firstScreenChecks,result:"PASS",realLedgerConnected:false};
    fs.writeFileSync(path.join(qaDir,"verification-v3.3.json"),JSON.stringify(verification,null,2));
    console.log("six-screen Alpha and auxiliary checks: PASS");
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
