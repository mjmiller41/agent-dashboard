// Hand-rolled 5-field cron -> human-readable description (PLAN.md §8 item 7:
// "human-readable schedule via hand-rolled describe fn"). Covers the common
// shapes (every N minutes, hourly, daily, weekly, monthly); anything else
// falls back to a literal field-by-field listing rather than guessing.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad2(value: string): string {
  return value.padStart(2, '0');
}

export function describeCronSchedule(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  const isNum = (v: string) => /^\d+$/.test(v);

  if (minute === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return 'Every minute';
  }
  if (minute.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return `Every ${minute.slice(2)} minutes`;
  }
  if (isNum(minute) && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return `At minute ${minute} of every hour`;
  }
  if (isNum(minute) && isNum(hour) && dom === '*' && month === '*' && dow === '*') {
    return `Every day at ${pad2(hour)}:${pad2(minute)}`;
  }
  if (isNum(minute) && isNum(hour) && dom === '*' && month === '*' && isNum(dow)) {
    const dayName = DAY_NAMES[Number(dow) % 7] ?? dow;
    return `Every ${dayName} at ${pad2(hour)}:${pad2(minute)}`;
  }
  if (isNum(minute) && isNum(hour) && isNum(dom) && month === '*' && dow === '*') {
    return `On day ${dom} of every month at ${pad2(hour)}:${pad2(minute)}`;
  }
  if (isNum(minute) && isNum(hour) && isNum(dom) && isNum(month) && dow === '*') {
    return `On ${dom}/${month} at ${pad2(hour)}:${pad2(minute)}`;
  }

  return `At minute ${minute}, hour ${hour}, day-of-month ${dom}, month ${month}, day-of-week ${dow}`;
}
