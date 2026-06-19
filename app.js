(function () {
  "use strict";

  const STORAGE_KEY = "us-stock-risk-calculator-v1";

  const assetClasses = [
    ["large", "미국 대형주 ETF"],
    ["nasdaq", "나스닥/기술주"],
    ["growth", "개별 성장주"],
    ["value", "개별 가치주"],
    ["dividend", "배당주"],
    ["semi", "반도체"],
    ["leveraged", "레버리지 ETF"],
    ["bonds", "채권/단기채"],
    ["cash", "현금"],
    ["reit", "리츠"],
    ["crypto", "코인"],
    ["other", "기타"]
  ];

  const builtInScenarios = {
    mild: { label: "Mild Correction", shocks: [-10, -15, -18, -10, -8, -20, -25, -2, 0, -12, -18, -8] },
    recession: { label: "Recession", shocks: [-25, -32, -40, -22, -20, -35, -55, 3, 0, -30, -45, -18] },
    inflation: { label: "Inflation Shock", shocks: [-18, -22, -25, -12, -15, -18, -35, -12, 0, -28, -20, -10] },
    tech: { label: "Tech Crash", shocks: [-15, -40, -48, -10, -12, -50, -65, 2, 0, -20, -35, -15] },
    liquidity: { label: "Liquidity Crisis", shocks: [-30, -38, -48, -28, -30, -42, -70, -8, -2, -38, -60, -25] }
  };

  const portfolioExamples = {
    stable: [
      { name: "대형주 ETF", amount: 45000, classId: "large" },
      { name: "단기채", amount: 30000, classId: "bonds" },
      { name: "현금", amount: 25000, classId: "cash" }
    ],
    growth: [
      { name: "대형주 ETF", amount: 35000, classId: "large" },
      { name: "기술주 ETF", amount: 30000, classId: "nasdaq" },
      { name: "성장주 A", amount: 20000, classId: "growth" },
      { name: "반도체 B", amount: 15000, classId: "semi" }
    ],
    leverage: [
      { name: "3배 레버리지 ETF", amount: 45000, classId: "leveraged" },
      { name: "기술주 ETF", amount: 30000, classId: "nasdaq" },
      { name: "코인", amount: 20000, classId: "crypto" },
      { name: "현금", amount: 5000, classId: "cash" }
    ]
  };

  const state = {
    portfolio: [],
    rebalancing: [],
    customScenarios: []
  };

  const byId = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const numberValue = (id, fallback = 0) => {
    const parsed = Number(byId(id)?.value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const classLabel = (id) => assetClasses.find((item) => item[0] === id)?.[1] || "기타";

  // 사용자 입력은 달러로 유지하고 결과 표시 단계에서만 원화로 환산한다.
  function formatMoney(usdValue) {
    if (!Number.isFinite(usdValue)) return "-";
    const currency = byId("display-currency").value;
    const rate = Math.max(1, numberValue("exchange-rate", 1400));
    const value = currency === "KRW" ? usdValue * rate : usdValue;
    return new Intl.NumberFormat(currency === "KRW" ? "ko-KR" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    }).format(value);
  }

  function formatPercent(value, digits = 1) {
    return Number.isFinite(value) ? `${value.toFixed(digits)}%` : "-";
  }

  function setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = value;
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createCell(text, tag = "td") {
    return createElement(tag, "", text);
  }

  function replaceRows(bodyId, rows) {
    const body = byId(bodyId);
    const fragment = document.createDocumentFragment();
    rows.forEach((row) => fragment.appendChild(row));
    body.replaceChildren(fragment);
  }

  function createBarList(containerId, items) {
    const container = byId(containerId);
    const fragment = document.createDocumentFragment();
    items.forEach(({ label, value, display }) => {
      const item = createElement("div", "bar-item");
      item.appendChild(createElement("span", "", label));
      const track = createElement("div", "bar-track");
      const fill = createElement("div", "bar-fill");
      fill.style.width = `${clamp(value, 0, 100)}%`;
      track.appendChild(fill);
      item.appendChild(track);
      item.appendChild(createElement("span", "bar-value", display || formatPercent(value)));
      fragment.appendChild(item);
    });
    container.replaceChildren(fragment);
  }

  function scenarioShockMap(array) {
    return Object.fromEntries(assetClasses.map(([id], index) => [id, Number(array[index]) || 0]));
  }

  function getScenarioMap(value) {
    if (builtInScenarios[value]) return scenarioShockMap(builtInScenarios[value].shocks);
    if (value.startsWith("custom:")) {
      return state.customScenarios.find((item) => item.id === value.slice(7))?.shocks || null;
    }
    return null;
  }

  function cloneExample(name) {
    return portfolioExamples[name].map((item) => ({ ...item, shock: 0 }));
  }

  // DCA 계산은 월말 납입과 월 유효수익률을 사용한다.
  function calculateDCA() {
    const initial = Math.max(0, numberValue("dca-initial"));
    const baseMonthly = Math.max(0, numberValue("dca-monthly"));
    const years = clamp(Math.floor(numberValue("dca-years", 1)), 1, 60);
    const annualReturn = numberValue("dca-return") / 100;
    const inflation = Math.max(0, numberValue("dca-inflation")) / 100;
    const increase = Math.max(0, numberValue("dca-increase")) / 100;
    const extra = Math.max(0, numberValue("dca-extra"));
    const extraYear = clamp(Math.floor(numberValue("dca-extra-year", 1)), 1, years);

    if (annualReturn <= -1) return;
    const monthlyRate = Math.pow(1 + annualReturn, 1 / 12) - 1;
    let balance = initial;
    let principal = initial;
    const yearly = [];

    for (let month = 1; month <= years * 12; month += 1) {
      balance *= 1 + monthlyRate;
      const yearIndex = Math.floor((month - 1) / 12);
      const contribution = baseMonthly * Math.pow(1 + increase, yearIndex);
      balance += contribution;
      principal += contribution;
      if (extra > 0 && month === extraYear * 12) {
        balance += extra;
        principal += extra;
      }
      if (month % 12 === 0) {
        const elapsedYears = month / 12;
        yearly.push({ year: elapsedYears, principal, balance, real: balance / Math.pow(1 + inflation, elapsedYears) });
      }
    }

    const profit = balance - principal;
    const realValue = balance / Math.pow(1 + inflation, years);
    setText("dca-principal", formatMoney(principal));
    setText("dca-final", formatMoney(balance));
    setText("dca-profit", formatMoney(profit));
    setText("dca-real", formatMoney(realValue));

    const principalShare = balance > 0 ? clamp((principal / balance) * 100, 0, 100) : 0;
    byId("dca-bars").innerHTML = `<div class="ratio-track"><span class="ratio-principal" style="width:${principalShare}%"></span><span class="ratio-profit" style="width:${100 - principalShare}%"></span></div><div class="ratio-legend"><span>원금 ${principalShare.toFixed(1)}%</span><span>수익 ${Math.max(0, 100 - principalShare).toFixed(1)}%</span></div>`;
    replaceRows("dca-table", yearly.map((item) => {
      const row = document.createElement("tr");
      row.append(createCell(`${item.year}년`, "th"), createCell(formatMoney(item.principal)), createCell(formatMoney(item.balance)), createCell(formatMoney(item.real)));
      return row;
    }));
  }

  // 낙폭과 회복률의 비대칭을 현재 금액 기준으로 계산한다.
  function calculateDrawdown() {
    const current = Math.max(0, numberValue("dd-current"));
    const rate = clamp(numberValue("dd-rate"), 0, 99.9) / 100;
    const extra = Math.max(0, numberValue("dd-extra"));
    const after = current * (1 - rate);
    const loss = current - after;
    const recovery = after > 0 ? current / after - 1 : Infinity;
    const afterExtra = after + extra;
    const recoveryExtra = afterExtra > 0 ? Math.max(0, current / afterExtra - 1) : Infinity;
    setText("dd-after", formatMoney(after));
    setText("dd-loss", formatMoney(loss));
    setText("dd-recovery", formatPercent(recovery * 100));
    setText("dd-recovery-extra", formatPercent(recoveryExtra * 100));

    const customMode = byId("dd-target").value === "custom";
    byId("dd-custom-wrap").hidden = !customMode;
    if (customMode) {
      const customRate = Math.max(0, numberValue("dd-custom")) / 100;
      const target = after * (1 + customRate);
      const needed = afterExtra > 0 ? Math.max(0, target / afterExtra - 1) : Infinity;
      setText("dd-target-result", `하락 후 금액 대비 ${formatPercent(customRate * 100)} 상승한 ${formatMoney(target)}을 기준으로 하면 추가 투자 후 필요한 상승률은 ${formatPercent(needed * 100)}입니다.`);
    } else {
      setText("dd-target-result", `하락 전 금액 ${formatMoney(current)}을 회복 기준으로 사용했습니다. 추가 투자금은 회복 기준 자체가 아니라 회복을 시작하는 금액에 반영됩니다.`);
    }

    const comparison = [10, 20, 30, 40, 50, 70];
    replaceRows("dd-table", comparison.map((drop) => {
      const remaining = current * (1 - drop / 100);
      const row = document.createElement("tr");
      row.append(createCell(`-${drop}%`, "th"), createCell(formatMoney(remaining)), createCell(formatMoney(current - remaining)), createCell(formatPercent((1 / (1 - drop / 100) - 1) * 100)));
      return row;
    }));
  }

  function buildAssetSelect(selected) {
    const select = document.createElement("select");
    assetClasses.forEach(([id, label]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = label;
      option.selected = id === selected;
      select.appendChild(option);
    });
    return select;
  }

  function renderScenarioOptions() {
    const select = byId("stress-scenario");
    const previous = select.value || "mild";
    const fragment = document.createDocumentFragment();
    Object.entries(builtInScenarios).forEach(([id, scenario]) => {
      const option = new Option(scenario.label, id);
      fragment.appendChild(option);
    });
    fragment.appendChild(new Option("Custom Scenario - 직접 입력", "manual"));
    state.customScenarios.forEach((scenario) => fragment.appendChild(new Option(`저장: ${scenario.name}`, `custom:${scenario.id}`)));
    select.replaceChildren(fragment);
    select.value = [...select.options].some((option) => option.value === previous) ? previous : "mild";
  }

  function applySelectedScenario() {
    const map = getScenarioMap(byId("stress-scenario").value);
    if (!map) return;
    state.portfolio.forEach((item) => { item.shock = map[item.classId] ?? 0; });
  }

  function renderPortfolio() {
    const body = byId("portfolio-body");
    const fragment = document.createDocumentFragment();
    state.portfolio.forEach((item, index) => {
      const row = document.createElement("tr");
      row.dataset.index = index;
      const nameCell = document.createElement("td");
      const name = document.createElement("input");
      name.type = "text";
      name.value = item.name;
      name.dataset.field = "name";
      name.setAttribute("aria-label", `${index + 1}번째 자산 이름`);
      nameCell.appendChild(name);
      const amountCell = document.createElement("td");
      const amount = document.createElement("input");
      amount.type = "number";
      amount.min = "0";
      amount.value = item.amount;
      amount.dataset.field = "amount";
      amount.setAttribute("aria-label", `${item.name || index + 1} 보유 금액`);
      amountCell.appendChild(amount);
      const classCell = document.createElement("td");
      const classSelect = buildAssetSelect(item.classId);
      classSelect.dataset.field = "classId";
      classSelect.setAttribute("aria-label", `${item.name || index + 1} 자산군`);
      classCell.appendChild(classSelect);
      const shockCell = document.createElement("td");
      const shock = document.createElement("input");
      shock.type = "number";
      shock.min = "-100";
      shock.max = "300";
      shock.step = "0.1";
      shock.value = item.shock;
      shock.dataset.field = "shock";
      shock.setAttribute("aria-label", `${item.name || index + 1} 충격률`);
      shockCell.appendChild(shock);
      const deleteCell = document.createElement("td");
      const remove = createElement("button", "row-delete", "삭제");
      remove.type = "button";
      remove.dataset.removePortfolio = index;
      remove.setAttribute("aria-label", `${item.name || index + 1} 행 삭제`);
      deleteCell.appendChild(remove);
      row.append(nameCell, amountCell, classCell, shockCell, deleteCell);
      fragment.appendChild(row);
    });
    body.replaceChildren(fragment);
  }

  // 입력된 보유 금액에 행별 충격률을 적용하고 손실 기여도를 합산한다.
  function calculateStress() {
    const items = state.portfolio.map((item) => ({ ...item, amount: Math.max(0, Number(item.amount) || 0), shock: clamp(Number(item.shock) || 0, -100, 300) }));
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    const results = items.map((item) => {
      const after = item.amount * (1 + item.shock / 100);
      return { ...item, after: Math.max(0, after), loss: item.amount - Math.max(0, after) };
    });
    const afterTotal = results.reduce((sum, item) => sum + item.after, 0);
    const loss = total - afterTotal;
    const rate = total > 0 ? (afterTotal / total - 1) * 100 : 0;
    setText("stress-total", formatMoney(total));
    setText("stress-after", formatMoney(afterTotal));
    setText("stress-loss", formatMoney(loss));
    setText("stress-rate", formatPercent(rate));
    setText("stress-warning", total > 0 ? "" : "보유 금액이 0보다 큰 자산을 하나 이상 입력해 주세요.");

    replaceRows("stress-result-body", results.map((item) => {
      const row = document.createElement("tr");
      row.append(createCell(item.name || "이름 없음", "th"), createCell(total > 0 ? formatPercent(item.amount / total * 100) : "-"), createCell(formatPercent(item.shock)), createCell(formatMoney(item.after)), createCell(formatMoney(Math.max(0, item.loss))));
      return row;
    }));

    const exposure = {};
    items.forEach((item) => { exposure[item.classId] = (exposure[item.classId] || 0) + item.amount; });
    createBarList("stress-exposure", Object.entries(exposure).sort((a, b) => b[1] - a[1]).map(([id, amount]) => ({ label: classLabel(id), value: total > 0 ? amount / total * 100 : 0 })));
    const biggest = [...results].sort((a, b) => b.loss - a.loss)[0];
    const recovery = afterTotal > 0 && afterTotal < total ? (total / afterTotal - 1) * 100 : 0;
    setText("stress-interpretation", total > 0 ? `손실 기여도가 가장 크게 나타나는 항목은 ${biggest?.name || "없음"}이며, 시나리오 이전 금액을 다시 기준으로 할 때 필요한 상승률은 ${formatPercent(recovery)}입니다.` : "자산을 입력하면 손실 기여도와 회복 필요 상승률을 표시합니다.");
    calculateRiskAnalyzer(items, total);
  }

  function calculateRiskAnalyzer(items, total) {
    const weightOf = (...classes) => total > 0 ? items.filter((item) => classes.includes(item.classId)).reduce((sum, item) => sum + item.amount, 0) / total * 100 : 0;
    const top3 = total > 0 ? [...items].sort((a, b) => b.amount - a.amount).slice(0, 3).reduce((sum, item) => sum + item.amount, 0) / total * 100 : 0;
    const individual = weightOf("growth", "value", "dividend", "semi");
    const etf = weightOf("large", "nasdaq", "leveraged");
    const leverage = weightOf("leveraged");
    const defensive = weightOf("cash", "bonds");
    const tech = weightOf("nasdaq", "growth", "semi");
    const crypto = weightOf("crypto");
    const concentrationScore = clamp((top3 - 35) * 1.5, 0, 100);
    const leverageScore = clamp(leverage * 4, 0, 100);
    const defensiveScore = clamp(defensive * 2, 0, 100);
    const diversification = clamp((items.filter((item) => item.amount > 0).length - 1) * 13 + (100 - top3) * 0.55, 0, 100);
    const score = total > 0 ? Math.round(clamp(18 + concentrationScore * 0.25 + leverageScore * 0.3 + tech * 0.18 + crypto * 0.2 + individual * 0.07 - defensiveScore * 0.12, 0, 100)) : 0;
    const grade = score <= 25 ? "방어적" : score <= 50 ? "균형형" : score <= 75 ? "공격형" : "고위험";
    setText("risk-score", String(score));
    setText("risk-grade", total > 0 ? grade : "입력 대기");
    setText("risk-summary", total > 0 ? `입력된 구성에서는 ${grade} 범위의 손실 민감도가 나타납니다. 점수 자체보다 어떤 노출이 점수를 높였는지 확인하세요.` : "스트레스 테스트에 자산을 입력하면 자동 분석됩니다.");
    setText("risk-top3", formatPercent(top3));
    setText("risk-individual", formatPercent(individual));
    setText("risk-etf", formatPercent(etf));
    setText("risk-leverage", formatPercent(leverage));
    setText("risk-defensive", formatPercent(defensive));
    setText("risk-tech", formatPercent(tech));
    setText("risk-crypto", formatPercent(crypto));
    setText("risk-diversification", `${Math.round(diversification)}점`);
    byId("risk-score-ring").style.borderTopColor = score <= 25 ? "#117a55" : score <= 50 ? "#1769d2" : score <= 75 ? "#c47a10" : "#b33a42";
    createBarList("risk-components", [
      { label: "집중도 점수", value: concentrationScore, display: `${Math.round(concentrationScore)}점` },
      { label: "방어자산 점수", value: defensiveScore, display: `${Math.round(defensiveScore)}점` },
      { label: "레버리지 위험", value: leverageScore, display: `${Math.round(leverageScore)}점` },
      { label: "분산도 점수", value: diversification, display: `${Math.round(diversification)}점` }
    ]);
  }

  function buildCustomGrid() {
    const grid = byId("custom-shock-grid");
    const fragment = document.createDocumentFragment();
    assetClasses.forEach(([id, label]) => {
      const wrapper = document.createElement("label");
      wrapper.textContent = `${label} 충격률 (%)`;
      const input = document.createElement("input");
      input.id = `custom-${id}`;
      input.type = "number";
      input.min = "-100";
      input.max = "300";
      input.step = "0.1";
      input.value = "-10";
      input.dataset.save = "";
      wrapper.appendChild(input);
      fragment.appendChild(wrapper);
    });
    grid.replaceChildren(fragment);
  }

  function currentCustomShocks() {
    return Object.fromEntries(assetClasses.map(([id]) => [id, clamp(numberValue(`custom-${id}`), -100, 300)]));
  }

  function updateCustomSummary() {
    const shocks = currentCustomShocks();
    const entries = Object.entries(shocks);
    const average = entries.reduce((sum, item) => sum + item[1], 0) / entries.length;
    const largest = [...entries].sort((a, b) => a[1] - b[1])[0];
    setText("custom-average", formatPercent(average));
    setText("custom-largest", `${classLabel(largest[0])} (${formatPercent(largest[1])})`);
  }

  function renderCustomList() {
    const container = byId("custom-list");
    if (!state.customScenarios.length) {
      container.replaceChildren(createElement("p", "muted", "저장된 커스텀 시나리오가 없습니다."));
      return;
    }
    const fragment = document.createDocumentFragment();
    state.customScenarios.forEach((scenario) => {
      const card = createElement("div", "saved-card");
      const copy = document.createElement("div");
      copy.appendChild(createElement("strong", "", scenario.name));
      const values = Object.values(scenario.shocks);
      copy.appendChild(createElement("p", "", `평균 충격률 ${formatPercent(values.reduce((a, b) => a + b, 0) / values.length)}`));
      const actions = createElement("div", "saved-card-actions");
      const apply = createElement("button", "button button-small", "스트레스에 적용");
      apply.type = "button";
      apply.dataset.applyCustom = scenario.id;
      const remove = createElement("button", "button button-small button-danger", "삭제");
      remove.type = "button";
      remove.dataset.deleteCustom = scenario.id;
      actions.append(apply, remove);
      card.append(copy, actions);
      fragment.appendChild(card);
    });
    container.replaceChildren(fragment);
  }

  // 레버리지 경로는 무작위가 아닌 반복 가능한 시나리오 함수로 만든다.
  function pathReturn(day, days, mean, volatility, scenario) {
    const progress = day / days;
    let value;
    if (scenario === "rise") value = mean + volatility * 0.28 * Math.sin(day * 0.42);
    else if (scenario === "volatile") value = mean * 0.1 + volatility * 1.25 * (day % 2 === 0 ? 1 : -1);
    else if (scenario === "crash") {
      if (progress < 0.14) value = mean - volatility * 1.8;
      else if (progress < 0.55) value = mean + volatility * 0.62;
      else value = mean + volatility * 0.2 * Math.sin(day * 0.35);
    } else value = mean * 0.1 + volatility * (day % 2 === 0 ? 1 : -1);
    return clamp(value, -0.95, 0.5);
  }

  function calculateLeverage() {
    const initial = Math.max(0, numberValue("lev-initial"));
    const multiple = numberValue("lev-multiple", 2);
    const mean = numberValue("lev-mean") / 100;
    const volatility = Math.max(0, numberValue("lev-vol")) / 100;
    const days = clamp(Math.floor(numberValue("lev-days", 252)), 2, 2000);
    const scenario = byId("lev-scenario").value;
    let underlying = initial;
    let leveraged = initial;
    const checkpoints = new Set([Math.max(1, Math.round(days * 0.25)), Math.max(1, Math.round(days * 0.5)), Math.max(1, Math.round(days * 0.75)), days]);
    const rows = [];
    for (let day = 1; day <= days; day += 1) {
      const daily = pathReturn(day, days, mean, volatility, scenario);
      underlying *= 1 + daily;
      leveraged *= Math.max(0, 1 + multiple * daily);
      const simple = initial > 0 ? initial * Math.max(0, 1 + multiple * (underlying / initial - 1)) : 0;
      if (checkpoints.has(day)) rows.push({ day, underlying, simple, leveraged });
    }
    const simpleFinal = initial > 0 ? initial * Math.max(0, 1 + multiple * (underlying / initial - 1)) : 0;
    setText("lev-underlying", formatMoney(underlying));
    setText("lev-simple", formatMoney(simpleFinal));
    setText("lev-daily", formatMoney(leveraged));
    setText("lev-gap", formatMoney(leveraged - simpleFinal));
    replaceRows("lev-table", rows.map((item) => {
      const row = document.createElement("tr");
      row.append(createCell(`${item.day}일`, "th"), createCell(formatMoney(item.underlying)), createCell(formatMoney(item.simple)), createCell(formatMoney(item.leveraged)));
      return row;
    }));
    const gapRate = simpleFinal > 0 ? (leveraged / simpleFinal - 1) * 100 : 0;
    setText("lev-explanation", `일별 재조정 결과는 단순 배율 비교값보다 ${formatPercent(Math.abs(gapRate))} ${gapRate >= 0 ? "높게" : "낮게"} 나타납니다. 변동성이 반복되면 상승과 하락의 순서 때문에 복리 경로가 달라질 수 있습니다.`);
  }

  function renderRebalancing() {
    const body = byId("rebalance-body");
    const fragment = document.createDocumentFragment();
    state.rebalancing.forEach((item, index) => {
      const row = document.createElement("tr");
      row.dataset.index = index;
      [["name", "text", item.name, "자산명"], ["amount", "number", item.amount, "현재 금액"], ["target", "number", item.target, "목표 비중"]].forEach(([field, type, value, label]) => {
        const cell = document.createElement("td");
        const input = document.createElement("input");
        input.type = type;
        if (type === "number") input.min = "0";
        input.value = value;
        input.dataset.field = field;
        input.setAttribute("aria-label", `${item.name || index + 1} ${label}`);
        cell.appendChild(input);
        row.appendChild(cell);
      });
      const deleteCell = document.createElement("td");
      const remove = createElement("button", "row-delete", "삭제");
      remove.type = "button";
      remove.dataset.removeRebalance = index;
      deleteCell.appendChild(remove);
      row.appendChild(deleteCell);
      fragment.appendChild(row);
    });
    body.replaceChildren(fragment);
  }

  // 목표 비중 합계가 100일 때만 배정 결과를 계산한다.
  function calculateRebalancing() {
    const items = state.rebalancing.map((item) => ({ name: item.name, amount: Math.max(0, Number(item.amount) || 0), target: Math.max(0, Number(item.target) || 0) }));
    const targetSum = items.reduce((sum, item) => sum + item.target, 0);
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    const extra = Math.max(0, numberValue("rebalance-extra"));
    const finalTotal = total + extra;
    if (!items.length || Math.abs(targetSum - 100) > 0.05 || finalTotal <= 0) {
      setText("rebalance-warning", `목표 비중 합계를 100%로 맞춰 주세요. 현재 합계: ${targetSum.toFixed(1)}%`);
      replaceRows("rebalance-result-body", []);
      return;
    }
    setText("rebalance-warning", "");
    const allowReduction = byId("rebalance-sell").checked;
    let adjustments;
    if (allowReduction) {
      adjustments = items.map((item) => finalTotal * item.target / 100 - item.amount);
    } else {
      const deficits = items.map((item) => Math.max(0, finalTotal * item.target / 100 - item.amount));
      const deficitTotal = deficits.reduce((sum, value) => sum + value, 0);
      if (deficitTotal >= extra && deficitTotal > 0) {
        adjustments = deficits.map((value) => extra * value / deficitTotal);
      } else {
        const remainder = Math.max(0, extra - deficitTotal);
        adjustments = deficits.map((value, index) => value + remainder * items[index].target / 100);
      }
    }
    replaceRows("rebalance-result-body", items.map((item, index) => {
      const adjusted = allowReduction ? item.amount + adjustments[index] : item.amount + Math.max(0, adjustments[index]);
      const row = document.createElement("tr");
      row.append(createCell(item.name || "이름 없음", "th"), createCell(formatPercent(total > 0 ? item.amount / total * 100 : 0)), createCell(formatPercent(item.target)), createCell(formatPercent((total > 0 ? item.amount / total * 100 : 0) - item.target)), createCell(`${adjustments[index] >= 0 ? "증액" : "감액"} ${formatMoney(Math.abs(adjustments[index]))}`), createCell(formatPercent(finalTotal > 0 ? adjusted / finalTotal * 100 : 0)));
      return row;
    }));
  }

  function simulateFire(rate) {
    const age = clamp(numberValue("fire-age", 35), 18, 90);
    let balance = Math.max(0, numberValue("fire-current"));
    const monthly = Math.max(0, numberValue("fire-monthly"));
    const expense = Math.max(0, numberValue("fire-expense"));
    const withdrawal = Math.max(0.001, numberValue("fire-withdrawal", 4) / 100);
    const directTarget = Math.max(0, numberValue("fire-target-direct"));
    const inflation = Math.max(0, numberValue("fire-inflation")) / 100;
    const baseTarget = directTarget > 0 ? directTarget : expense / withdrawal;
    const monthlyRate = rate <= -1 ? -1 : Math.pow(1 + rate, 1 / 12) - 1;
    let principal = balance;
    let months = 0;
    let target = baseTarget;
    while (months < 960 && age + months / 12 < 100) {
      target = baseTarget * Math.pow(1 + inflation, months / 12);
      if (balance >= target) break;
      balance = balance * (1 + monthlyRate) + monthly;
      principal += monthly;
      months += 1;
    }
    return { age, months, balance, principal, target, reached: balance >= target, baseTarget };
  }

  function calculateFire() {
    const result = simulateFire(numberValue("fire-return") / 100);
    setText("fire-target", formatMoney(result.baseTarget));
    setText("fire-result-age", result.reached ? `${(result.age + result.months / 12).toFixed(1)}세` : "계산 범위 내 미도달");
    setText("fire-years", result.reached ? `${(result.months / 12).toFixed(1)}년` : "80년 초과");
    setText("fire-principal-profit", `${formatMoney(result.principal)} / ${formatMoney(result.balance - result.principal)}`);
    replaceRows("fire-table", [4, 7, 10, 12].map((rate) => {
      const item = simulateFire(rate / 100);
      const row = document.createElement("tr");
      row.append(createCell(`${rate}%`, "th"), createCell(item.reached ? `${(item.age + item.months / 12).toFixed(1)}세` : "미도달"), createCell(item.reached ? `${(item.months / 12).toFixed(1)}년` : "80년 초과"), createCell(formatMoney(item.balance)));
      return row;
    }));
  }

  function calculateProfile() {
    const answers = [...document.querySelectorAll("[data-profile]")];
    const raw = answers.reduce((sum, input) => sum + Number(input.value || 0), 0);
    const score = Math.round(raw / 50 * 100);
    const profiles = [
      [16, "Defensive", "변동성과 손실을 제한하려는 성향이 강하게 나타납니다.", "재무 완충력과 손실 한도를 먼저 확인하려는 태도", "물가와 장기 목표 대비 실질 구매력 저하 가능성", "비상자금, 부채, 투자 기간을 숫자로 정리해 보세요."],
      [33, "Conservative", "낮은 변동성을 선호하면서 제한적인 위험을 수용하는 성향입니다.", "위험 노출을 신중하게 확대하려는 태도", "짧은 경험에 비해 장기 가정을 과신하지 않는지 점검", "하락 회복 계산기로 감내 가능한 낙폭을 확인하세요."],
      [50, "Balanced", "안정성과 성장 가능성을 함께 비교하려는 성향입니다.", "여러 목표와 위험 요소를 균형 있게 살피는 태도", "균형이라는 표현만으로 실제 집중도를 놓칠 가능성", "스트레스 테스트에서 자산군별 손실 기여도를 확인하세요."],
      [67, "Growth", "장기 목표를 위해 비교적 높은 변동성을 수용하는 성향입니다.", "장기 계획과 시장 변동을 함께 고려하는 태도", "기술·성장 자산 집중도가 예상보다 높아질 가능성", "위험 분석에서 상위 자산 집중도와 방어자산 비중을 확인하세요."],
      [83, "Aggressive", "큰 가격 변동을 감수할 의향이 높게 나타납니다.", "긴 투자 기간과 높은 변동성에 대한 인식", "실제 손실 상황에서 설문 응답과 행동이 달라질 가능성", "-40% 이상의 하락 시나리오에서 자금 계획을 검토하세요."],
      [100, "Speculative", "매우 높은 변동성과 구조적 위험을 감수할 의향이 나타납니다.", "복잡한 위험 구조를 학습하려는 태도", "레버리지, 집중도와 유동성 위험이 동시에 확대될 가능성", "레버리지 일간 복리와 유동성 위기 시나리오를 함께 비교하세요."]
    ];
    const profile = profiles.find((item) => score <= item[0]);
    setText("profile-score", String(score));
    setText("profile-type", profile[1]);
    setText("profile-description", profile[2]);
    setText("profile-strength", profile[3]);
    setText("profile-caution", profile[4]);
    setText("profile-next", profile[5]);
  }

  function calculateAll() {
    calculateDCA();
    calculateDrawdown();
    calculateStress();
    updateCustomSummary();
    calculateLeverage();
    calculateRebalancing();
    calculateFire();
    calculateProfile();
  }

  // 정적 입력, 동적 포트폴리오와 커스텀 시나리오를 하나의 객체로 저장한다.
  function collectStorageData() {
    const inputs = {};
    document.querySelectorAll("[data-save]").forEach((input, index) => {
      const key = input.id || `anonymous-${index}`;
      inputs[key] = input.type === "checkbox" ? input.checked : input.value;
    });
    return { inputs, portfolio: state.portfolio, rebalancing: state.rebalancing, customScenarios: state.customScenarios };
  }

  function saveAll(message = "입력값을 이 브라우저에 저장했습니다.") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collectStorageData()));
      setText("storage-status", message);
    } catch (error) {
      setText("storage-status", "브라우저 저장소를 사용할 수 없습니다.");
    }
  }

  function assignStorageKeys() {
    document.querySelectorAll("[data-save]").forEach((input, index) => {
      if (!input.id) input.dataset.storageKey = `anonymous-${index}`;
    });
  }

  function loadAll(showMessage = true) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved) {
        if (showMessage) setText("storage-status", "저장된 입력값이 없습니다.");
        return false;
      }
      state.customScenarios = Array.isArray(saved.customScenarios) ? saved.customScenarios : [];
      state.portfolio = Array.isArray(saved.portfolio) && saved.portfolio.length ? saved.portfolio : cloneExample("growth");
      state.rebalancing = Array.isArray(saved.rebalancing) && saved.rebalancing.length ? saved.rebalancing : defaultRebalancing();
      renderScenarioOptions();
      renderPortfolio();
      renderRebalancing();
      renderCustomList();
      document.querySelectorAll("[data-save]").forEach((input, index) => {
        const key = input.id || input.dataset.storageKey || `anonymous-${index}`;
        if (!(key in saved.inputs)) return;
        if (input.type === "checkbox") input.checked = Boolean(saved.inputs[key]);
        else input.value = saved.inputs[key];
      });
      calculateAll();
      if (showMessage) setText("storage-status", "저장된 입력값을 불러왔습니다.");
      return true;
    } catch (error) {
      if (showMessage) setText("storage-status", "저장 데이터를 읽을 수 없습니다.");
      return false;
    }
  }

  function defaultRebalancing() {
    return [
      { name: "대형주 ETF", amount: 50000, target: 50 },
      { name: "채권", amount: 25000, target: 30 },
      { name: "현금", amount: 15000, target: 20 }
    ];
  }

  function resetAll() {
    localStorage.removeItem(STORAGE_KEY);
    document.querySelectorAll("form").forEach((form) => form.reset());
    state.customScenarios = [];
    state.portfolio = cloneExample("growth");
    state.rebalancing = defaultRebalancing();
    renderScenarioOptions();
    applySelectedScenario();
    renderPortfolio();
    renderRebalancing();
    renderCustomList();
    calculateAll();
    setText("storage-status", "저장 데이터와 입력값을 초기화했습니다.");
  }

  function setValues(values) {
    Object.entries(values).forEach(([id, value]) => {
      const input = byId(id);
      if (input) input.value = value;
    });
    calculateAll();
  }

  function applyExample(name) {
    if (name === "dca") setValues({ "dca-initial": 20000, "dca-monthly": 800, "dca-years": 15, "dca-return": 7, "dca-inflation": 2.5, "dca-increase": 3, "dca-extra": 5000, "dca-extra-year": 4 });
    if (name === "drawdown") setValues({ "dd-current": 80000, "dd-rate": 40, "dd-extra": 12000, "dd-target": "principal" });
    if (name === "custom") {
      byId("custom-name").value = "기술 성장군 충격 예시";
      assetClasses.forEach(([id]) => { byId(`custom-${id}`).value = ["nasdaq", "growth", "semi", "leveraged"].includes(id) ? -45 : ["cash", "bonds"].includes(id) ? 0 : -15; });
      updateCustomSummary();
    }
    if (name === "leverage") setValues({ "lev-initial": 10000, "lev-multiple": 3, "lev-mean": 0.03, "lev-vol": 2.2, "lev-days": 252, "lev-scenario": "volatile" });
    if (name === "rebalancing") {
      state.rebalancing = [{ name: "주식 ETF", amount: 65000, target: 55 }, { name: "채권", amount: 20000, target: 25 }, { name: "현금", amount: 10000, target: 20 }];
      byId("rebalance-extra").value = 5000;
      renderRebalancing();
      calculateRebalancing();
    }
    if (name === "fire") setValues({ "fire-age": 32, "fire-current": 120000, "fire-monthly": 1500, "fire-return": 7, "fire-expense": 45000, "fire-withdrawal": 4, "fire-target-direct": 0, "fire-inflation": 2.5 });
    if (name === "profile") {
      document.querySelectorAll("[data-profile]").forEach((input) => { input.selectedIndex = Math.min(2, input.options.length - 1); });
      calculateProfile();
    }
  }

  function bindEvents() {
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; calculateAll(); });
    };
    document.addEventListener("input", schedule);
    document.addEventListener("change", schedule);
    document.querySelectorAll("form").forEach((form) => form.addEventListener("reset", () => setTimeout(calculateAll, 0)));
    byId("save-all").addEventListener("click", () => saveAll());
    byId("load-all").addEventListener("click", () => loadAll(true));
    byId("reset-all").addEventListener("click", resetAll);

    byId("stress-scenario").addEventListener("change", () => { applySelectedScenario(); renderPortfolio(); calculateAll(); });
    byId("add-portfolio-row").addEventListener("click", () => {
      const map = getScenarioMap(byId("stress-scenario").value);
      state.portfolio.push({ name: `자산 ${state.portfolio.length + 1}`, amount: 0, classId: "other", shock: map?.other || 0 });
      renderPortfolio();
      calculateAll();
    });
    byId("reset-portfolio").addEventListener("click", () => {
      byId("stress-scenario").value = "mild";
      state.portfolio = cloneExample("growth");
      applySelectedScenario();
      renderPortfolio();
      calculateAll();
    });
    document.querySelectorAll("[data-portfolio-example]").forEach((button) => button.addEventListener("click", () => {
      state.portfolio = cloneExample(button.dataset.portfolioExample);
      applySelectedScenario();
      renderPortfolio();
      calculateAll();
    }));
    byId("portfolio-body").addEventListener("input", (event) => {
      const row = event.target.closest("tr");
      if (!row || !event.target.dataset.field) return;
      const item = state.portfolio[Number(row.dataset.index)];
      item[event.target.dataset.field] = event.target.dataset.field === "name" || event.target.dataset.field === "classId" ? event.target.value : Number(event.target.value);
      calculateAll();
    });
    byId("portfolio-body").addEventListener("change", (event) => {
      const row = event.target.closest("tr");
      if (!row || event.target.dataset.field !== "classId") return;
      const item = state.portfolio[Number(row.dataset.index)];
      item.classId = event.target.value;
      const map = getScenarioMap(byId("stress-scenario").value);
      if (map) item.shock = map[item.classId] || 0;
      renderPortfolio();
      calculateAll();
    });
    byId("portfolio-body").addEventListener("click", (event) => {
      if (event.target.dataset.removePortfolio === undefined) return;
      state.portfolio.splice(Number(event.target.dataset.removePortfolio), 1);
      renderPortfolio();
      calculateAll();
    });

    byId("custom-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const name = byId("custom-name").value.trim();
      if (!name) { setText("storage-status", "커스텀 시나리오 이름을 입력해 주세요."); return; }
      state.customScenarios.push({ id: `${Date.now()}`, name, shocks: currentCustomShocks() });
      renderScenarioOptions();
      renderCustomList();
      saveAll("커스텀 시나리오를 저장했습니다.");
    });
    byId("custom-list").addEventListener("click", (event) => {
      if (event.target.dataset.applyCustom) {
        byId("stress-scenario").value = `custom:${event.target.dataset.applyCustom}`;
        applySelectedScenario();
        renderPortfolio();
        calculateAll();
      }
      if (event.target.dataset.deleteCustom) {
        state.customScenarios = state.customScenarios.filter((item) => item.id !== event.target.dataset.deleteCustom);
        renderScenarioOptions();
        renderCustomList();
        saveAll("커스텀 시나리오를 삭제했습니다.");
      }
    });

    byId("rebalance-add").addEventListener("click", () => { state.rebalancing.push({ name: `자산 ${state.rebalancing.length + 1}`, amount: 0, target: 0 }); renderRebalancing(); calculateRebalancing(); });
    byId("rebalance-import").addEventListener("click", () => {
      const active = state.portfolio.filter((item) => Number(item.amount) > 0);
      const equal = active.length ? 100 / active.length : 0;
      state.rebalancing = active.map((item) => ({ name: item.name, amount: item.amount, target: Number(equal.toFixed(2)) }));
      if (state.rebalancing.length) state.rebalancing[state.rebalancing.length - 1].target += 100 - state.rebalancing.reduce((sum, item) => sum + item.target, 0);
      renderRebalancing();
      calculateRebalancing();
    });
    byId("reset-rebalancing").addEventListener("click", () => {
      state.rebalancing = defaultRebalancing();
      byId("rebalance-extra").value = 5000;
      byId("rebalance-sell").checked = false;
      renderRebalancing();
      calculateRebalancing();
    });
    byId("rebalance-body").addEventListener("input", (event) => {
      const row = event.target.closest("tr");
      if (!row || !event.target.dataset.field) return;
      const item = state.rebalancing[Number(row.dataset.index)];
      item[event.target.dataset.field] = event.target.dataset.field === "name" ? event.target.value : Number(event.target.value);
      calculateRebalancing();
    });
    byId("rebalance-body").addEventListener("click", (event) => {
      if (event.target.dataset.removeRebalance === undefined) return;
      state.rebalancing.splice(Number(event.target.dataset.removeRebalance), 1);
      renderRebalancing();
      calculateRebalancing();
    });

    document.querySelectorAll("[data-example]").forEach((button) => button.addEventListener("click", () => applyExample(button.dataset.example)));
  }

  function initialize() {
    buildCustomGrid();
    state.portfolio = cloneExample("growth");
    state.rebalancing = defaultRebalancing();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(saved?.customScenarios)) state.customScenarios = saved.customScenarios;
    } catch (error) {
      state.customScenarios = [];
    }
    renderScenarioOptions();
    applySelectedScenario();
    renderPortfolio();
    renderRebalancing();
    renderCustomList();
    assignStorageKeys();
    bindEvents();
    calculateAll();
  }

  initialize();
})();
