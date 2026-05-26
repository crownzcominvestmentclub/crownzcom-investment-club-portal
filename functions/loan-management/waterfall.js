function toInteger(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function allocateProRataByOutstanding(guarantorRows, principalAmount) {
  const rows = guarantorRows
    .map((row) => ({
      ...row,
      remainingOutstanding: toInteger(
        row.securedOutstanding ?? row.approvedAmount ?? row.guaranteedAmount,
        0
      )
    }))
    .filter((row) => row.remainingOutstanding > 0);

  const totalOutstanding = rows.reduce((sum, row) => sum + row.remainingOutstanding, 0);
  const allocatable = Math.max(0, Math.min(toInteger(principalAmount, 0), totalOutstanding));
  if (allocatable <= 0 || totalOutstanding <= 0) {
    return { allocatable: 0, totalOutstanding, allocations: [] };
  }

  const work = rows.map((row) => {
    const raw = (allocatable * row.remainingOutstanding) / totalOutstanding;
    return {
      ...row,
      share: Math.floor(raw),
      fraction: raw - Math.floor(raw)
    };
  });

  for (const row of work) {
    if (row.share > row.remainingOutstanding) {
      row.share = row.remainingOutstanding;
    }
  }

  let assigned = work.reduce((sum, row) => sum + row.share, 0);
  let remainder = allocatable - assigned;

  if (remainder > 0) {
    work.sort((a, b) =>
      (b.fraction - a.fraction) ||
      (b.remainingOutstanding - a.remainingOutstanding) ||
      String(a.$id || '').localeCompare(String(b.$id || ''))
    );

    while (remainder > 0) {
      let progressed = false;
      for (const row of work) {
        if (row.share < row.remainingOutstanding) {
          row.share += 1;
          remainder -= 1;
          progressed = true;
          if (remainder === 0) break;
        }
      }
      if (!progressed) break;
    }
  }

  assigned = work.reduce((sum, row) => sum + row.share, 0);
  return {
    allocatable: assigned,
    totalOutstanding,
    allocations: work
      .filter((row) => row.share > 0)
      .map((row) => ({
        requestId: row.$id,
        share: row.share,
        previousOutstanding: row.remainingOutstanding,
        nextOutstanding: Math.max(0, row.remainingOutstanding - row.share)
      }))
  };
}

module.exports = {
  allocateProRataByOutstanding
};
