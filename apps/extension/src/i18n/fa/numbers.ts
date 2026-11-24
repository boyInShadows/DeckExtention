const formatter = new Intl.NumberFormat('fa-IR', { useGrouping: false });

export const number = (value: number): string => formatter.format(value);
