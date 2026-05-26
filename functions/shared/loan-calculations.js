const INTEREST_CALCULATION_MODES = {
  FLAT: 'flat',
  REDUCING_BALANCE: 'reducing_balance'
};

function toInteger(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeInterestCalculationMode(mode) {
  const value = String(mode || '').trim().toLowerCase();
  if (value === INTEREST_CALCULATION_MODES.REDUCING_BALANCE) {
    return INTEREST_CALCULATION_MODES.REDUCING_BALANCE;
  }
  return INTEREST_CALCULATION_MODES.FLAT;
}

function calculateMonthlyInterest(principal, monthlyRate) {
  return Math.floor(principal * monthlyRate);
}

function generateRepaymentSchedule({
  principal,
  months,
  monthlyRate,
  customPayments = null,
  interestCalculationMode = INTEREST_CALCULATION_MODES.FLAT
}) {
  const normalizedMode = normalizeInterestCalculationMode(interestCalculationMode);
  const normalizedPrincipal = Math.max(0, toInteger(principal, 0));
  const normalizedMonths = Math.max(1, toInteger(months, 1));
  const schedule = [];
  const monthlyInterest = calculateMonthlyInterest(normalizedPrincipal, monthlyRate);

  if (customPayments && customPayments.length > 0) {
    if (!Array.isArray(customPayments) || customPayments.length !== normalizedMonths) {
      throw new Error('Custom repayment plan must provide one amount per month.');
    }

    let remainingBalance = normalizedPrincipal;
    customPayments.forEach((rawPayment, index) => {
      const payment = toInteger(rawPayment, 0);
      if (payment <= 0) {
        throw new Error(`Custom payment for month ${index + 1} must be greater than zero.`);
      }
      const interestForMonth =
        normalizedMode === INTEREST_CALCULATION_MODES.REDUCING_BALANCE
          ? calculateMonthlyInterest(remainingBalance, monthlyRate)
          : monthlyInterest;
      const principalPart = payment - interestForMonth;
      if (principalPart < 0) {
        throw new Error(`Custom payment for month ${index + 1} is below monthly interest.`);
      }

      remainingBalance = Math.max(0, remainingBalance - principalPart);
      schedule.push({
        month: index + 1,
        payment,
        principal: principalPart,
        interest: interestForMonth,
        balance: remainingBalance
      });
    });

    if (remainingBalance > 0) {
      throw new Error('Custom repayment plan does not clear full principal.');
    }

    return schedule;
  }

  if (normalizedMode === INTEREST_CALCULATION_MODES.REDUCING_BALANCE) {
    const basePrincipal = Math.floor(normalizedPrincipal / normalizedMonths);
    let principalRemainder = normalizedPrincipal - (basePrincipal * normalizedMonths);
    let remainingBalance = normalizedPrincipal;

    for (let month = 1; month <= normalizedMonths; month += 1) {
      const extraPrincipal = principalRemainder > 0 ? 1 : 0;
      principalRemainder = Math.max(0, principalRemainder - extraPrincipal);
      const principalPart = Math.min(remainingBalance, basePrincipal + extraPrincipal);
      const interestPart = calculateMonthlyInterest(remainingBalance, monthlyRate);
      const payment = principalPart + interestPart;
      remainingBalance = Math.max(0, remainingBalance - principalPart);

      schedule.push({
        month,
        payment,
        principal: principalPart,
        interest: interestPart,
        balance: remainingBalance
      });
    }

    return schedule;
  }

  const totalInterest = monthlyInterest * normalizedMonths;
  const totalRepayment = normalizedPrincipal + totalInterest;
  const monthlyPayment = Math.ceil(totalRepayment / normalizedMonths);
  let remainingBalance = normalizedPrincipal;

  for (let month = 1; month <= normalizedMonths; month += 1) {
    const principalPart = monthlyPayment - monthlyInterest;
    remainingBalance = Math.max(0, remainingBalance - principalPart);
    schedule.push({
      month,
      payment: monthlyPayment,
      principal: principalPart,
      interest: monthlyInterest,
      balance: remainingBalance
    });
  }

  return schedule;
}

function calculateScheduledInterest({
  loanAmount,
  planItem,
  currentBalance,
  monthlyRate,
  interestCalculationMode
}) {
  if (planItem && planItem.interest !== undefined && planItem.interest !== null) {
    return Math.max(0, toInteger(planItem.interest, 0));
  }

  const mode = normalizeInterestCalculationMode(interestCalculationMode);
  if (mode === INTEREST_CALCULATION_MODES.REDUCING_BALANCE) {
    const scheduledPrincipal = Math.max(0, toInteger(planItem?.principal, 0));
    const monthEndBalance = Math.max(0, toInteger(planItem?.balance, currentBalance));
    const monthOpeningBalance = Math.max(0, monthEndBalance + scheduledPrincipal);
    return Math.floor(monthOpeningBalance * monthlyRate);
  }

  const originalPrincipal = Math.max(0, toInteger(loanAmount, currentBalance));
  return Math.floor(originalPrincipal * monthlyRate);
}

function calculateEarlyPayoffInterest({
  loanAmount,
  currentBalance,
  monthlyRate,
  earlyPenaltyRate,
  interestCalculationMode
}) {
  const mode = normalizeInterestCalculationMode(interestCalculationMode);
  const principal = Math.max(0, toInteger(loanAmount, currentBalance));
  const balance = Math.max(0, toInteger(currentBalance, principal));
  const interestBase = mode === INTEREST_CALCULATION_MODES.REDUCING_BALANCE
    ? balance
    : principal;
  const regularInterest = Math.ceil(interestBase * monthlyRate);
  const penaltyInterest = Math.ceil(interestBase * earlyPenaltyRate);
  return {
    interestBase,
    regularInterest,
    penaltyInterest,
    totalInterest: regularInterest + penaltyInterest
  };
}

module.exports = {
  INTEREST_CALCULATION_MODES,
  normalizeInterestCalculationMode,
  calculateMonthlyInterest,
  generateRepaymentSchedule,
  calculateScheduledInterest,
  calculateEarlyPayoffInterest
};
