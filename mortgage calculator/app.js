const defaults = {
  loanType: "commercial",
  commercialPrincipal: 100,
  commercialRate: 3.45,
  fundPrincipal: 60,
  fundRate: 2.85,
  loanDate: "",
  years: 30,
  repaymentType: "equalPayment",
  paidMonths: 0,
  prepayments: [
    { month: 0, amount: 0, times: 1, interval: 12, mode: "reduceTerm", repaymentType: "equalPayment" },
  ],
};

const STORAGE_KEY = "mortgage-calculator-state-v1";

const fields = {
  loanType: document.querySelector("#loanType"),
  commercialPrincipal: document.querySelector("#commercialPrincipal"),
  commercialRate: document.querySelector("#commercialRate"),
  fundPrincipal: document.querySelector("#fundPrincipal"),
  fundRate: document.querySelector("#fundRate"),
  loanDate: document.querySelector("#loanDate"),
  years: document.querySelector("#years"),
  repaymentType: document.querySelector("#repaymentType"),
  paidMonths: document.querySelector("#paidMonths"),
  prepaymentList: document.querySelector("#prepaymentList"),
  addPrepaymentButton: document.querySelector("#addPrepaymentButton"),
};

const output = {
  interestSaved: document.querySelector("#interestSaved"),
  originalInterest: document.querySelector("#originalInterest"),
  newInterest: document.querySelector("#newInterest"),
  newRemainingMonths: document.querySelector("#newRemainingMonths"),
  remainingBefore: document.querySelector("#remainingBefore"),
  remainingAfter: document.querySelector("#remainingAfter"),
  nextOriginalPayment: document.querySelector("#nextOriginalPayment"),
  nextNewPayment: document.querySelector("#nextNewPayment"),
  originalBar: document.querySelector("#originalBar"),
  newBar: document.querySelector("#newBar"),
  originalBarValue: document.querySelector("#originalBarValue"),
  newBarValue: document.querySelector("#newBarValue"),
  chartCaption: document.querySelector("#chartCaption"),
  scheduleBody: document.querySelector("#scheduleBody"),
  newDetailBody: document.querySelector("#newDetailBody"),
  exportButton: document.querySelector("#exportButton"),
  originalTab: document.querySelector("#originalTab"),
  newTab: document.querySelector("#newTab"),
};

let activeSchedule = "new";
let latestResult = null;
let activeScheduleRows = [];
let isRestoringState = false;

function currency(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function monthText(months) {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest}个月`;
  if (rest === 0) return `${years}年`;
  return `${years}年${rest}个月`;
}

function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthValueToIndex(value) {
  const [year, month] = String(value || getCurrentMonthValue())
    .split("-")
    .map(Number);
  return year * 12 + month - 1;
}

function formatYearMonth(value, offsetMonths = 0) {
  const index = monthValueToIndex(value) + offsetMonths;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}年${String(month).padStart(2, "0")}月`;
}

function readDuration(yearSelector, monthSelector) {
  const years = Math.max(0, Math.round(Number(yearSelector.value)));
  const months = Math.min(11, Math.max(0, Math.round(Number(monthSelector.value))));
  monthSelector.value = String(months);
  return years * 12 + months;
}

function writeDuration(totalMonths, yearSelector, monthSelector) {
  const safeMonths = Math.max(0, Math.round(totalMonths));
  yearSelector.value = String(Math.floor(safeMonths / 12));
  monthSelector.value = String(safeMonths % 12);
}

function getMonthlyPayment(principal, monthlyRate, months) {
  if (months <= 0) return 0;
  if (monthlyRate === 0) return principal / months;
  const factor = (1 + monthlyRate) ** months;
  return (principal * monthlyRate * factor) / (factor - 1);
}

function buildEqualPaymentSchedule(principal, monthlyRate, months, startingMonth = 1, targetPayment) {
  const rows = [];
  let balance = principal;
  const payment = targetPayment ?? getMonthlyPayment(principal, monthlyRate, months);

  for (let i = 1; i <= months && balance > 0.005; i += 1) {
    const interest = balance * monthlyRate;
    let principalPaid = payment - interest;

    if (monthlyRate === 0) principalPaid = balance / (months - i + 1);
    if (principalPaid <= 0) break;
    if (principalPaid > balance) principalPaid = balance;

    const actualPayment = principalPaid + interest;
    balance = Math.max(0, balance - principalPaid);
    rows.push({
      month: startingMonth + i - 1,
      payment: actualPayment,
      principal: principalPaid,
      interest,
      balance,
    });
  }

  return rows;
}

function buildEqualPrincipalSchedule(principal, monthlyRate, months, startingMonth = 1) {
  const rows = [];
  let balance = principal;
  const monthlyPrincipal = months > 0 ? principal / months : 0;

  for (let i = 1; i <= months && balance > 0.005; i += 1) {
    const interest = balance * monthlyRate;
    const principalPaid = Math.min(monthlyPrincipal, balance);
    const payment = principalPaid + interest;
    balance = Math.max(0, balance - principalPaid);
    rows.push({
      month: startingMonth + i - 1,
      payment,
      principal: principalPaid,
      interest,
      balance,
    });
  }

  return rows;
}

function buildComponentSchedule(component, months, repaymentType, startingMonth = 1, targetPayment) {
  const monthlyRate = component.annualRate / 100 / 12;
  if (repaymentType === "equalPrincipal") {
    return buildEqualPrincipalSchedule(component.principal, monthlyRate, months, startingMonth);
  }
  return buildEqualPaymentSchedule(
    component.principal,
    monthlyRate,
    months,
    startingMonth,
    targetPayment,
  );
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + row[key], 0);
}

function createBreakdown() {
  return {
    commercial: { principal: 0, interest: 0 },
    fund: { principal: 0, interest: 0 },
  };
}

function addBreakdownValue(breakdown, componentId, principal, interest) {
  if (!breakdown[componentId]) return;
  breakdown[componentId].principal += principal;
  breakdown[componentId].interest += interest;
}

function mergeSchedules(componentSchedules, months) {
  const rows = [];

  for (let month = 1; month <= months; month += 1) {
    const sameMonthRows = componentSchedules
      .map((item) => ({ component: item.component, row: item.rows[month - 1] }))
      .filter((item) => item.row);
    if (!sameMonthRows.length) break;

    const components = createBreakdown();
    sameMonthRows.forEach((item) => {
      addBreakdownValue(components, item.component.id, item.row.principal, item.row.interest);
    });

    rows.push({
      month,
      payment: sameMonthRows.reduce((total, item) => total + item.row.payment, 0),
      principal: sameMonthRows.reduce((total, item) => total + item.row.principal, 0),
      interest: sameMonthRows.reduce((total, item) => total + item.row.interest, 0),
      balance: sameMonthRows.reduce((total, item) => total + item.row.balance, 0),
      components,
    });
  }

  return rows;
}

function createPrepaymentRow(plan = {}) {
  const index = fields.prepaymentList.children.length + 1;
  const card = document.createElement("div");
  card.className = "prepayment-card";
  card.innerHTML = `
    <div class="prepayment-card-header">
      <span>第 ${index} 段</span>
      <button class="remove-prepayment" type="button">删除</button>
    </div>
    <div class="prepayment-grid">
      <label>
        还款时间
        <span class="input-with-unit">
          <input class="prepay-month" type="number" min="0" step="1" value="${plan.month ?? defaults.paidMonths}" />
          <span>期后</span>
        </span>
      </label>
      <label>
        每次金额
        <span class="input-with-unit">
          <input class="prepay-amount" type="number" min="0" step="1" value="${plan.amount ?? 0}" />
          <span>万元</span>
        </span>
      </label>
      <label>
        还款次数
        <span class="input-with-unit">
          <input class="prepay-times" type="number" min="1" step="1" value="${plan.times ?? 1}" />
          <span>次</span>
        </span>
      </label>
      <label>
        间隔时间
        <span class="input-with-unit">
          <input class="prepay-interval" type="number" min="1" step="1" value="${plan.interval ?? 12}" />
          <span>月</span>
        </span>
      </label>
      <label class="prepayment-mode-field">
        还款后方案
        <select class="prepay-mode">
          <option value="reduceTerm" ${(plan.mode ?? "reduceTerm") === "reduceTerm" ? "selected" : ""}>月供不变，缩短期限</option>
          <option value="reducePayment" ${(plan.mode ?? "reduceTerm") === "reducePayment" ? "selected" : ""}>期限不变，降低月供</option>
        </select>
      </label>
      <label class="prepayment-repayment-field">
        还款方式
        <select class="prepay-repayment-type">
          <option value="equalPayment" ${(plan.repaymentType ?? defaults.repaymentType) === "equalPayment" ? "selected" : ""}>等额本息</option>
          <option value="equalPrincipal" ${(plan.repaymentType ?? defaults.repaymentType) === "equalPrincipal" ? "selected" : ""}>等额本金</option>
        </select>
      </label>
    </div>
  `;
  fields.prepaymentList.append(card);
}

function renumberPrepaymentRows() {
  fields.prepaymentList.querySelectorAll(".prepayment-card-header span").forEach((node, index) => {
    node.textContent = `第 ${index + 1} 段`;
  });
}

function renderPrepaymentRows(plans) {
  fields.prepaymentList.innerHTML = "";
  plans.forEach((plan) => createPrepaymentRow(plan));
}

function readPrepaymentPlans() {
  return readPrepaymentRows()
    .map((plan) => ({ ...plan, amount: plan.amount * 10000 }))
    .filter((plan) => plan.amount > 0 && plan.times > 0);
}

function readPrepaymentRows() {
  return Array.from(fields.prepaymentList.querySelectorAll(".prepayment-card")).map((card) => {
    return {
      month: Math.max(0, Math.round(Number(card.querySelector(".prepay-month").value))),
      amount: Math.max(0, Number(card.querySelector(".prepay-amount").value)),
      times: Math.max(1, Math.round(Number(card.querySelector(".prepay-times").value))),
      interval: Math.max(1, Math.round(Number(card.querySelector(".prepay-interval").value))),
      mode: card.querySelector(".prepay-mode").value,
      repaymentType: card.querySelector(".prepay-repayment-type").value,
    };
  });
}

function expandPrepaymentEvents(plans, paidMonths, totalMonths) {
  const events = new Map();

  plans.forEach((plan) => {
    for (let i = 0; i < plan.times; i += 1) {
      const month = Math.max(paidMonths, plan.month + i * plan.interval);
      if (month > totalMonths) continue;
      const current = events.get(month) ?? [];
      current.push({ amount: plan.amount, mode: plan.mode, repaymentType: plan.repaymentType });
      events.set(month, current);
    }
  });

  return events;
}

function getLoanComponents() {
  const loanType = fields.loanType.value;
  const components = [];
  const commercialPrincipal = Math.max(0, Number(fields.commercialPrincipal.value) * 10000);
  const fundPrincipal = Math.max(0, Number(fields.fundPrincipal.value) * 10000);

  if (loanType === "commercial" || loanType === "combo") {
    components.push({
      id: "commercial",
      name: "商业贷款",
      principal: commercialPrincipal,
      annualRate: Math.max(0, Number(fields.commercialRate.value)),
    });
  }

  if (loanType === "fund" || loanType === "combo") {
    components.push({
      id: "fund",
      name: "公积金贷款",
      principal: fundPrincipal,
      annualRate: Math.max(0, Number(fields.fundRate.value)),
    });
  }

  return components.filter((component) => component.principal > 0);
}

function readInputs() {
  const years = Number(fields.years.value);
  return {
    loanType: fields.loanType.value,
    components: getLoanComponents(),
    principal: getLoanComponents().reduce((total, component) => total + component.principal, 0),
    loanDate: fields.loanDate.value || getCurrentMonthValue(),
    years,
    months: Math.round(years * 12),
    repaymentType: fields.repaymentType.value,
    paidMonths: Math.max(0, Math.round(Number(fields.paidMonths.value))),
    prepaymentPlans: readPrepaymentPlans(),
  };
}

function getBalanceBefore(schedule, monthIndex) {
  const row = schedule[monthIndex];
  if (!row) return 0;
  return row.balance + row.principal;
}

function buildOriginalPlan(input) {
  const componentSchedules = input.components.map((component) => ({
    component,
    rows: buildComponentSchedule(component, input.months, input.repaymentType),
  }));

  return {
    componentSchedules,
    rows: mergeSchedules(componentSchedules, input.months),
  };
}

function allocatePrepayment(states, amount) {
  let remaining = amount;
  const allocations = [];

  states
    .filter((state) => state.balance > 0)
    .sort((left, right) => {
      if (left.component.id === "commercial" && right.component.id !== "commercial") return -1;
      if (right.component.id === "commercial" && left.component.id !== "commercial") return 1;
      return right.component.annualRate - left.component.annualRate;
    })
    .forEach((state) => {
      if (remaining <= 0) return;
      const principalPaid = Math.min(remaining, state.balance);
      state.balance = Math.max(0, state.balance - principalPaid);
      remaining -= principalPaid;
      allocations.push({ state, amount: principalPaid });
    });

  return allocations;
}

function buildScheduleWithPrepayments(input, originalPlan, maxPaidMonths) {
  const prepaymentEvents = expandPrepaymentEvents(
    input.prepaymentPlans,
    maxPaidMonths,
    input.months,
  );
  const paidRows = originalPlan.rows.slice(0, maxPaidMonths);
  const rows = [...paidRows];
  const states = originalPlan.componentSchedules.map(({ component, rows: componentRows }) => ({
    component,
    balance: getBalanceBefore(componentRows, maxPaidMonths),
    currentPayment: componentRows[maxPaidMonths]?.payment ?? 0,
    originalMonthlyPrincipal: input.months > 0 ? component.principal / input.months : 0,
    currentMonthlyPrincipal: input.months > 0 ? component.principal / input.months : 0,
    repaymentType: input.repaymentType,
    lastPayment: componentRows[Math.max(0, maxPaidMonths - 1)]?.payment ?? componentRows[maxPaidMonths]?.payment ?? 0,
  }));
  let firstPrepayBalance = states.reduce((total, state) => total + state.balance, 0);
  let totalPrepaid = 0;

  function totalBalance() {
    return states.reduce((total, state) => total + state.balance, 0);
  }

  function applyPrepayment(month) {
    const monthEvents = [
      ...(prepaymentEvents.get(month) ?? []),
      ...(month === 1 ? (prepaymentEvents.get(0) ?? []) : []),
    ];
    if (!monthEvents.length || totalBalance() <= 0) return;

    let principalPaid = 0;
    const recalculationStates = new Set();
    const allAllocations = [];

    monthEvents.forEach((event) => {
      if (event.amount <= 0 || totalBalance() <= 0) return;
      const allocations = allocatePrepayment(states, event.amount);
      allAllocations.push(...allocations);
      principalPaid += allocations.reduce((total, allocation) => total + allocation.amount, 0);

      if (event.mode === "reducePayment") {
        allocations.forEach((allocation) => recalculationStates.add(allocation.state));
      }

      states.forEach((state) => {
        state.repaymentType = event.repaymentType ?? state.repaymentType;
      });
    });

    if (principalPaid <= 0) return;

    totalPrepaid += principalPaid;
    if (totalPrepaid === principalPaid) firstPrepayBalance = totalBalance();
    const components = createBreakdown();
    allAllocations.forEach((allocation) => {
      addBreakdownValue(components, allocation.state.component.id, allocation.amount, 0);
    });

    rows.push({
      month,
      payment: principalPaid,
      principal: principalPaid,
      interest: 0,
      balance: totalBalance(),
      isPrepay: true,
      components,
    });

    states.forEach((state) => {
      if (state.balance <= 0) return;
      const monthlyRate = state.component.annualRate / 100 / 12;
      const remainingMonths = Math.max(0, input.months - month);

      if (recalculationStates.has(state)) {
        state.currentPayment = getMonthlyPayment(state.balance, monthlyRate, remainingMonths);
        state.currentMonthlyPrincipal = remainingMonths > 0 ? state.balance / remainingMonths : 0;
        return;
      }

      if (state.repaymentType === "equalPayment") {
        state.currentPayment = state.lastPayment || state.currentPayment;
      } else {
        state.currentMonthlyPrincipal = state.currentMonthlyPrincipal || state.originalMonthlyPrincipal;
      }
    });
  }

  if (maxPaidMonths > 0) applyPrepayment(maxPaidMonths);

  for (let month = maxPaidMonths + 1; month <= input.months && totalBalance() > 0.005; month += 1) {
    const remainingMonths = input.months - month + 1;
    const row = {
      month,
      payment: 0,
      principal: 0,
      interest: 0,
      balance: 0,
      components: createBreakdown(),
    };

    states.forEach((state) => {
      if (state.balance <= 0) return;

      const monthlyRate = state.component.annualRate / 100 / 12;
      const interest = state.balance * monthlyRate;
      let principalPaid = 0;
      let payment = 0;

      if (state.repaymentType === "equalPrincipal") {
        principalPaid = Math.min(state.currentMonthlyPrincipal, state.balance);
        payment = principalPaid + interest;
      } else {
        principalPaid =
          monthlyRate === 0 ? state.balance / remainingMonths : state.currentPayment - interest;
        if (principalPaid <= 0) return;
        principalPaid = Math.min(principalPaid, state.balance);
        payment = principalPaid + interest;
      }

      state.balance = Math.max(0, state.balance - principalPaid);
      row.payment += payment;
      row.principal += principalPaid;
      row.interest += interest;
      addBreakdownValue(row.components, state.component.id, principalPaid, interest);
      state.lastPayment = payment;
    });

    row.balance = totalBalance();
    if (row.payment > 0) rows.push(row);
    applyPrepayment(month);
  }

  return {
    rows,
    futureRows: rows.filter((row) => row.month > maxPaidMonths || row.isPrepay),
    totalPrepaid,
    firstPrepayBalance,
    prepaymentCount: Array.from(prepaymentEvents.values()).flat().filter((event) => event.amount > 0)
      .length,
  };
}

function calculate() {
  const input = readInputs();
  const maxPaidMonths = Math.min(input.paidMonths, input.months);
  fields.paidMonths.value = String(maxPaidMonths);

  if (input.principal <= 0 || input.years <= 0) {
    return null;
  }

  const originalPlan = buildOriginalPlan(input);
  const paidRows = originalPlan.rows.slice(0, maxPaidMonths);
  const remainingRows = originalPlan.rows.slice(maxPaidMonths);
  const remainingBefore = remainingRows[0]
    ? remainingRows[0].balance + remainingRows[0].principal
    : 0;
  const newPlan = buildScheduleWithPrepayments(input, originalPlan, maxPaidMonths);
  const originalTotalInterest = sum(originalPlan.rows, "interest");
  const paidInterest = sum(paidRows, "interest");
  const newTotalInterest = paidInterest + sum(newPlan.futureRows, "interest");
  const interestSaved = originalTotalInterest - newTotalInterest;
  const firstNewPayment = newPlan.futureRows.find((row) => !row.isPrepay)?.payment ?? 0;
  const remainingMonthlyRows = newPlan.futureRows.filter((row) => !row.isPrepay);

  return {
    input,
    maxPaidMonths,
    totalPrepaid: newPlan.totalPrepaid,
    remainingBefore,
    remainingAfter: newPlan.firstPrepayBalance,
    originalSchedule: originalPlan.rows,
    newSchedule: newPlan.rows,
    remainingRows,
    newRemainingRows: remainingMonthlyRows,
    originalTotalInterest,
    newTotalInterest,
    interestSaved,
    nextOriginalPayment: remainingRows[0]?.payment ?? 0,
    nextNewPayment: firstNewPayment,
    prepaymentCount: newPlan.prepaymentCount,
  };
}

function renderSchedule(rows) {
  const visibleRows = rows;
  activeScheduleRows = visibleRows;
  const placeholderCount = Math.max(0, 10 - visibleRows.length);
  const loanDate = latestResult?.input.loanDate ?? getCurrentMonthValue();
  const tableWrap = output.scheduleBody.closest(".table-wrap");
  const previousScrollTop = tableWrap?.scrollTop ?? 0;
  output.scheduleBody.innerHTML = [
    ...visibleRows.map(
      (row, index) => `
        <tr class="${row.isPrepay ? "highlight" : ""}" data-row-index="${index}">
          <td>${
            row.isPrepay
              ? `提前还款 ${formatYearMonth(loanDate, row.month)}`
              : `第${row.month}期 ${formatYearMonth(loanDate, row.month - 1)}`
          }</td>
          <td>${currency(row.payment)}</td>
          <td>${currency(row.principal)}</td>
          <td>${currency(row.interest)}</td>
          <td>${currency(row.balance)}</td>
        </tr>
      `,
    ),
    ...Array.from(
      { length: placeholderCount },
      () => `<tr class="placeholder"><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>`,
    ),
  ].join("");
  if (tableWrap) tableWrap.scrollTop = previousScrollTop;
}

function renderNewDetailSchedule(rows) {
  const visibleRows = rows;
  const placeholderCount = Math.max(0, 10 - visibleRows.length);
  const loanDate = latestResult?.input.loanDate ?? getCurrentMonthValue();
  const tableWrap = output.newDetailBody.closest(".table-wrap");
  const previousScrollTop = tableWrap?.scrollTop ?? 0;

  output.newDetailBody.innerHTML = [
    ...visibleRows.map((row) => {
      const components = row.components ?? createBreakdown();
      return `
        <tr class="${row.isPrepay ? "highlight" : ""}" data-detail-key="${row.month}-${row.isPrepay ? "prepay" : "normal"}">
          <td>${
            row.isPrepay
              ? `提前还款 ${formatYearMonth(loanDate, row.month)}`
              : `第${row.month}期 ${formatYearMonth(loanDate, row.month - 1)}`
          }</td>
          <td>${currency(row.payment)}</td>
          <td>${currency(components.commercial.principal)}</td>
          <td>${currency(components.commercial.interest)}</td>
          <td>${currency(components.fund.principal)}</td>
          <td>${currency(components.fund.interest)}</td>
        </tr>
      `;
    }),
    ...Array.from(
      { length: placeholderCount },
      () => `<tr class="placeholder"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>`,
    ),
  ].join("");

  if (tableWrap) tableWrap.scrollTop = previousScrollTop;
}

function exportCell(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function amountValue(value) {
  return Number(value || 0).toFixed(2);
}

function isAmountLike(value) {
  return typeof value === "number" || /^-?\d+(\.\d+)?$/.test(String(value));
}

function rowLabel(row, loanDate) {
  return row.isPrepay
    ? `提前还款 ${formatYearMonth(loanDate, row.month)}`
    : `第${row.month}期 ${formatYearMonth(loanDate, row.month - 1)}`;
}

function excelCell(value = "", styleId = "Text", type = "String", mergeAcross = 0) {
  const merge = mergeAcross > 0 ? ` ss:MergeAcross="${mergeAcross}"` : "";
  return `<Cell ss:StyleID="${styleId}"${merge}><Data ss:Type="${type}">${exportCell(value)}</Data></Cell>`;
}

function excelEmptyCell(styleId = "Text") {
  return `<Cell ss:StyleID="${styleId}" />`;
}

function excelNumberCell(value, styleId = "Number") {
  return excelCell(amountValue(value), styleId, "Number");
}

function excelRow(cells, height) {
  return `<Row${height ? ` ss:Height="${height}"` : ""}>${cells.join("")}</Row>`;
}

function rowCells(row, loanDate, stylePrefix = "") {
  if (!row) {
    return Array.from({ length: 5 }, () => excelEmptyCell());
  }

  const textStyle = row.isPrepay ? `${stylePrefix}PrepayText` : `${stylePrefix}Text`;
  const numberStyle = row.isPrepay ? `${stylePrefix}PrepayNumber` : `${stylePrefix}Number`;
  return [
    excelCell(rowLabel(row, loanDate), textStyle),
    excelNumberCell(row.payment, numberStyle),
    excelNumberCell(row.principal, numberStyle),
    excelNumberCell(row.interest, numberStyle),
    excelNumberCell(row.balance, numberStyle),
  ];
}

function detailRowCells(row, loanDate) {
  if (!row) {
    return Array.from({ length: 6 }, () => excelEmptyCell());
  }

  const components = row.components ?? createBreakdown();
  const textStyle = row.isPrepay ? "PrepayText" : "Text";
  const numberStyle = row.isPrepay ? "PrepayNumber" : "Number";
  return [
    excelCell(rowLabel(row, loanDate), textStyle),
    excelNumberCell(row.payment, numberStyle),
    excelNumberCell(components.commercial.principal, numberStyle),
    excelNumberCell(components.commercial.interest, numberStyle),
    excelNumberCell(components.fund.principal, numberStyle),
    excelNumberCell(components.fund.interest, numberStyle),
  ];
}

function worksheet(name, tableRows, columnWidths) {
  return `
    <Worksheet ss:Name="${exportCell(name)}">
      <Table>
        ${columnWidths.map((width) => `<Column ss:Width="${width}" />`).join("")}
        ${tableRows.join("")}
      </Table>
    </Worksheet>
  `;
}

function exportExcel() {
  if (!latestResult) return;

  const result = latestResult;
  const loanDate = result.input.loanDate;
  const summaryRows = [
    ["预计节省利息", amountValue(Math.max(0, result.interestSaved))],
    ["原总利息", amountValue(result.originalTotalInterest)],
    ["提前还款后总利息", amountValue(result.newTotalInterest)],
    ["提前还款后剩余时间", monthText(result.newRemainingRows.length)],
    ["当前剩余本金", amountValue(result.remainingBefore)],
    ["首次提前后本金", amountValue(result.remainingAfter)],
    ["原下一期月供", amountValue(result.nextOriginalPayment)],
    ["新下一期月供", amountValue(result.nextNewPayment)],
  ];
  const inputRows = [
    ["贷款类型", { commercial: "商业贷款", fund: "公积金贷款", combo: "组合贷款" }[result.input.loanType]],
    ["商业贷款本金", amountValue(Number(fields.commercialPrincipal.value) * 10000)],
    ["商业贷款年利率", `${fields.commercialRate.value}%`],
    ["公积金贷款本金", amountValue(Number(fields.fundPrincipal.value) * 10000)],
    ["公积金贷款年利率", `${fields.fundRate.value}%`],
    ["贷款日期", result.input.loanDate],
    ["贷款年限", `${result.input.years}年`],
    ["还款方式", result.input.repaymentType === "equalPayment" ? "等额本息" : "等额本金"],
    ["已还期数", `${result.maxPaidMonths}期`],
  ];
  const prepaymentRows = Array.from(fields.prepaymentList.querySelectorAll(".prepayment-card")).map(
    (card, index) => [
      `提前还款第${index + 1}段`,
      `${card.querySelector(".prepay-month").value || 0}期后`,
      amountValue(Number(card.querySelector(".prepay-amount").value || 0) * 10000),
      `${card.querySelector(".prepay-times").value || 1}次`,
      `${card.querySelector(".prepay-interval").value || 1}个月`,
      card.querySelector(".prepay-mode").selectedOptions[0]?.textContent ?? "",
      card.querySelector(".prepay-repayment-type").selectedOptions[0]?.textContent ?? "",
    ],
  );

  const summarySheetRows = [
    excelRow([excelCell("房贷还款计划汇总", "Title", "String", 1)], 28),
    excelRow([excelCell(`贷款日期：${loanDate}`, "Meta", "String", 1)]),
    excelRow([excelCell(`导出时间：${new Date().toLocaleString("zh-CN")}`, "Meta", "String", 1)]),
    excelRow([excelEmptyCell(), excelEmptyCell()]),
    excelRow([excelCell("项目", "Header"), excelCell("金额/时间", "Header")]),
    ...summaryRows.map((row) =>
      excelRow([
        excelCell(row[0], "SummaryKey"),
        isAmountLike(row[1])
          ? excelCell(row[1], "SummaryCurrency", "Number")
          : excelCell(row[1], "SummaryValue"),
      ]),
    ),
  ];
  const inputSheetRows = [
    excelRow([excelCell("贷款信息", "Title", "String", 6)], 28),
    excelRow([excelCell("基础参数", "GroupHeader", "String", 1)]),
    excelRow([excelCell("项目", "Header"), excelCell("输入值", "Header")]),
    ...inputRows.map((row) =>
      excelRow([
        excelCell(row[0], "SummaryKey"),
        isAmountLike(row[1]) ? excelCell(row[1], "SummaryCurrency", "Number") : excelCell(row[1], "SummaryValue"),
      ]),
    ),
    excelRow([excelEmptyCell(), excelEmptyCell()]),
    excelRow([excelCell("提前还款计划", "GroupHeader", "String", 6)]),
    excelRow(
      ["段落", "还款时间", "每次金额", "还款次数", "间隔时间", "还款后方案", "还款方式"].map((header) =>
        excelCell(header, "Header"),
      ),
    ),
    ...prepaymentRows.map((row) =>
      excelRow(
        row.map((cell, index) =>
          index === 2 && isAmountLike(cell)
            ? excelCell(cell, "SummaryCurrency", "Number")
            : excelCell(cell, index === 0 ? "SummaryKey" : "SummaryValue"),
        ),
      ),
    ),
  ];

  const combinedSheetRows = [
    excelRow(
      [
        excelCell("原计划", "GroupHeader", "String", 4),
        excelEmptyCell("Spacer"),
        excelCell("新还款计划", "GroupHeader", "String", 4),
        excelEmptyCell("Spacer"),
        excelCell("新计划明细", "GroupHeader", "String", 5),
      ],
      24,
    ),
    excelRow([
      ...["年月", "月供", "本金", "利息", "剩余本金"].map((header) => excelCell(header, "Header")),
      excelEmptyCell("Spacer"),
      ...["年月", "月供", "本金", "利息", "剩余本金"].map((header) => excelCell(header, "Header")),
      excelEmptyCell("Spacer"),
      ...["年月", "月供", "商贷本金", "商贷利息", "公积金本金", "公积金利息"].map((header) =>
        excelCell(header, "Header"),
      ),
    ]),
    ...result.newSchedule.map((row) => {
      const originalRow = row.isPrepay ? null : result.originalSchedule[row.month - 1];
      return excelRow([
        ...rowCells(originalRow, loanDate),
        excelEmptyCell("Spacer"),
        ...rowCells(row, loanDate),
        excelEmptyCell("Spacer"),
        ...detailRowCells(row, loanDate),
      ]);
    }),
  ];

  const workbook = `
    <?xml version="1.0" encoding="UTF-8"?>
    <?mso-application progid="Excel.Sheet"?>
    <Workbook
      xmlns="urn:schemas-microsoft-com:office:spreadsheet"
      xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
      <Styles>
        <Style ss:ID="Title">
          <Font ss:Bold="1" ss:Color="#11583F" ss:Size="16" />
          <Alignment ss:Horizontal="Left" ss:Vertical="Center" />
        </Style>
        <Style ss:ID="Meta">
          <Font ss:Color="#64716D" ss:Size="10" />
        </Style>
        <Style ss:ID="Header">
          <Font ss:Bold="1" ss:Color="#FFFFFF" />
          <Interior ss:Color="#1F7A5A" ss:Pattern="Solid" />
          <Borders>
            <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B9C8C2" />
            <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B9C8C2" />
            <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B9C8C2" />
            <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B9C8C2" />
          </Borders>
          <Alignment ss:Horizontal="Center" ss:Vertical="Center" />
        </Style>
        <Style ss:ID="GroupHeader">
          <Font ss:Bold="1" ss:Color="#17201D" />
          <Interior ss:Color="#EEF4F1" ss:Pattern="Solid" />
          <Alignment ss:Horizontal="Center" ss:Vertical="Center" />
        </Style>
        <Style ss:ID="SummaryKey">
          <Font ss:Bold="1" ss:Color="#64716D" />
          <Interior ss:Color="#EEF4F1" ss:Pattern="Solid" />
        </Style>
        <Style ss:ID="SummaryValue">
          <Alignment ss:Horizontal="Right" />
        </Style>
        <Style ss:ID="SummaryCurrency">
          <Alignment ss:Horizontal="Right" />
          <NumberFormat ss:Format="&quot;¥&quot;#,##0.00" />
        </Style>
        <Style ss:ID="Text">
          <Alignment ss:Horizontal="Left" />
        </Style>
        <Style ss:ID="Number">
          <Alignment ss:Horizontal="Right" />
          <NumberFormat ss:Format="&quot;¥&quot;#,##0.00" />
        </Style>
        <Style ss:ID="PrepayText">
          <Font ss:Bold="1" ss:Color="#11583F" />
          <Interior ss:Color="#FFF3C4" ss:Pattern="Solid" />
          <Alignment ss:Horizontal="Left" />
        </Style>
        <Style ss:ID="PrepayNumber">
          <Font ss:Bold="1" ss:Color="#11583F" />
          <Interior ss:Color="#FFF3C4" ss:Pattern="Solid" />
          <Alignment ss:Horizontal="Right" />
          <NumberFormat ss:Format="&quot;¥&quot;#,##0.00" />
        </Style>
        <Style ss:ID="Spacer">
          <Interior ss:Color="#FFFFFF" ss:Pattern="Solid" />
        </Style>
      </Styles>
      ${worksheet("房贷还款计划汇总", summarySheetRows, [150, 150])}
      ${worksheet("贷款信息", inputSheetRows, [130, 120, 120, 100, 100, 170, 100])}
      ${worksheet(
        "还款计划对比",
        combinedSheetRows,
        [170, 95, 95, 95, 110, 18, 170, 95, 95, 95, 110, 18, 170, 95, 95, 95, 110, 110],
      )}
    </Workbook>
  `;
  const blob = new Blob(["\ufeff", workbook], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `房贷还款计划-${loanDate}.xls`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function updateLoanTypeView() {
  document
    .querySelector('[data-part="commercial"]')
    .classList.toggle("is-hidden", fields.loanType.value === "fund");
  document
    .querySelector('[data-part="fund"]')
    .classList.toggle("is-hidden", fields.loanType.value === "commercial");
}

function render() {
  updateLoanTypeView();
  latestResult = calculate();
  if (!latestResult) return;

  const result = latestResult;
  const maxInterest = Math.max(result.originalTotalInterest, result.newTotalInterest, 1);
  const saved = Math.max(0, result.interestSaved);

  output.interestSaved.textContent = currency(saved);
  output.originalInterest.textContent = currency(result.originalTotalInterest);
  output.newInterest.textContent = currency(result.newTotalInterest);
  output.newRemainingMonths.textContent = monthText(result.newRemainingRows.length);
  output.remainingBefore.textContent = currency(result.remainingBefore);
  output.remainingAfter.textContent = currency(result.remainingAfter);
  output.nextOriginalPayment.textContent = currency(result.nextOriginalPayment);
  output.nextNewPayment.textContent = currency(result.nextNewPayment);
  output.originalBar.style.width = `${(result.originalTotalInterest / maxInterest) * 100}%`;
  output.newBar.style.width = `${(result.newTotalInterest / maxInterest) * 100}%`;
  output.originalBarValue.textContent = currency(result.originalTotalInterest);
  output.newBarValue.textContent = currency(result.newTotalInterest);
  output.chartCaption.textContent =
    result.totalPrepaid > 0
      ? `${result.prepaymentCount}次提前还款，共${currency(result.totalPrepaid)}，节省${currency(saved)}`
      : "未设置提前还款计划";

  renderSchedule(activeSchedule === "original" ? result.originalSchedule : result.newSchedule);
  renderNewDetailSchedule(result.newSchedule);
}

function setActiveSchedule(next) {
  activeSchedule = next;
  output.originalTab.classList.toggle("active", next === "original");
  output.newTab.classList.toggle("active", next === "new");
  if (latestResult) {
    renderSchedule(next === "original" ? latestResult.originalSchedule : latestResult.newSchedule);
  }
}

function resetForm() {
  fields.loanType.value = defaults.loanType;
  fields.commercialPrincipal.value = defaults.commercialPrincipal;
  fields.commercialRate.value = defaults.commercialRate;
  fields.fundPrincipal.value = defaults.fundPrincipal;
  fields.fundRate.value = defaults.fundRate;
  fields.loanDate.value = getCurrentMonthValue();
  fields.years.value = defaults.years;
  fields.repaymentType.value = defaults.repaymentType;
  fields.paidMonths.value = defaults.paidMonths;
  renderPrepaymentRows(defaults.prepayments);
  setActiveSchedule("new");
  render();
}

document.querySelector("#loanForm").addEventListener("input", render);
document.querySelector("#loanForm").addEventListener("change", render);
document.querySelector("#resetButton").addEventListener("click", resetForm);
fields.addPrepaymentButton.addEventListener("click", () => {
  createPrepaymentRow({
    month: 0,
    amount: 0,
    times: 1,
    interval: 12,
    mode: "reduceTerm",
    repaymentType: fields.repaymentType.value,
  });
  render();
});
fields.prepaymentList.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove-prepayment");
  if (!removeButton) return;
  removeButton.closest(".prepayment-card").remove();
  if (!fields.prepaymentList.children.length) createPrepaymentRow();
  renumberPrepaymentRows();
  render();
});
output.originalTab.addEventListener("click", () => setActiveSchedule("original"));
output.newTab.addEventListener("click", () => setActiveSchedule("new"));
output.exportButton.addEventListener("click", exportExcel);
output.scheduleBody.addEventListener("click", (event) => {
  const rowElement = event.target.closest("tr[data-row-index]");
  if (!rowElement) return;

  const row = activeScheduleRows[Number(rowElement.dataset.rowIndex)];
  if (!row) return;

  const key = `${row.month}-${row.isPrepay ? "prepay" : "normal"}`;
  const detailRow = output.newDetailBody.querySelector(`[data-detail-key="${key}"]`);
  if (!detailRow) return;

  detailRow.scrollIntoView({ behavior: "smooth", block: "center" });
  detailRow.classList.remove("jump-highlight");
  requestAnimationFrame(() => detailRow.classList.add("jump-highlight"));
});

fields.loanDate.value = getCurrentMonthValue();
renderPrepaymentRows(defaults.prepayments);
render();
