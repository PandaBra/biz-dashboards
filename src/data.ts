export type PageId = "home" | "sales" | "calendar" | "clients" | "stock" | "team";

export const company = {
  name: "Beauty Studio",
  shortName: "Beauty",
};

export function money(amount: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}
