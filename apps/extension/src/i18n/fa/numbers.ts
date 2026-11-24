let formatter: Intl.NumberFormat | undefined;

export const number = (value: number): string => {
  formatter ??= new Intl.NumberFormat('fa-IR', { useGrouping: false });
  return formatter.format(value);
};
