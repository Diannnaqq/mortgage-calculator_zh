---
name: mortgage-calculator
description: Maintain and extend a static Chinese mortgage calculator web app. Use when Codex is asked to change 房贷/提前还款/商业贷款/公积金贷款/组合贷款 calculations, repayment schedule tables, local browser caching, or Excel export behavior in a plain HTML/CSS/JavaScript calculator.
---

# Mortgage Calculator

## Overview

Use this skill for the static mortgage calculator app built from `index.html`, `styles.css`, and `app.js`. Preserve the app as a no-build, client-only tool unless the user explicitly asks for a framework or backend.

## Workflow

1. Inspect the relevant UI and calculation code before editing.
2. Keep calculation changes in `app.js`, layout changes in `index.html`, and visual changes in `styles.css`.
3. Run `node --check app.js` after JavaScript changes.
4. For UI-sensitive changes, preview in a browser and verify desktop and mobile overflow.
5. Preserve existing Chinese labels and financial terminology unless the user asks to rename them.

## Calculation Rules

- Support 商业贷款, 公积金贷款, and 组合贷款.
- For 组合贷款, calculate commercial and provident-fund loans separately, then sum monthly payment, principal, interest, and remaining principal.
- Advance repayment amount is applied after the normal monthly payment for that month.
- Advance repayment principal is applied to 商业贷款 first; only after commercial loan balance is exhausted should it apply to 公积金贷款.
- Per advance-repayment segment:
  - `mode` controls whether affected loan components reduce term or reduce payment.
  - `repaymentType` switches both commercial and provident-fund components to 等额本息 or 等额本金 from that event onward.
- Do not treat combo loans as one pooled loan with one total monthly payment. Maintain component-level state, then sum.

## UI Rules

- Keep the first screen as the calculator, not a landing page.
- Keep tool controls compact and operational.
- Advance repayment cards should remain inside a scrollable list instead of growing the whole sidebar indefinitely.
- Main repayment schedule rows can jump to matching rows in 新计划明细.
- Tables should keep stable dimensions and use internal scrolling when needed.
- Ensure mobile pages do not horizontally overflow; wide tables may scroll internally.

## Excel Export Rules

- Export as a browser-generated `.xls` file without a server.
- Include these sheets:
  - `房贷还款计划汇总`
  - `贷款信息`
  - `还款计划对比`
- In `还款计划对比`, place 原计划, 新还款计划, and 新计划明细 horizontally in the same sheet.
- Align the same period on the same row. For advance-repayment rows, leave 原计划 cells blank.
- Format all amount cells as currency.

## Local Cache Rules

- If adding or modifying cache, use browser `localStorage`.
- Save all input fields and all advance-repayment cards.
- Reset should restore defaults and clear cached state.
- Corrupt or missing cache should fail gracefully and fall back to defaults.
