const systemDark = matchMedia("(prefers-color-scheme: dark)");

/** An explicit choice in localStorage wins over the system preference. */
export const isDark = () => (localStorage.theme ?? (systemDark.matches ? "dark" : "light")) === "dark";

export const applyTheme = () => document.documentElement.classList.toggle("dark", isDark());

export function toggleTheme() {
  localStorage.theme = isDark() ? "light" : "dark";
  applyTheme();
}

systemDark.onchange = applyTheme;
