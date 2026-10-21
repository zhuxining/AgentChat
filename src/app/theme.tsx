import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

export type Theme = "system" | "light" | "dark";
export type FontSize = "small" | "normal" | "large";
const storageKey = "agentchat.theme";
const fontSizeStorageKey = "agentchat.fontSize";

export function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

export function isFontSize(value: unknown): value is FontSize {
  return value === "small" || value === "normal" || value === "large";
}

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(storageKey);
    return isTheme(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function readFontSize(): FontSize {
  try {
    const saved = localStorage.getItem(fontSizeStorageKey);
    return isFontSize(saved) ? saved : "normal";
  } catch {
    return "normal";
  }
}

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
  fontSize: FontSize;
  setFontSize: (fontSize: FontSize) => void;
  storageError: string;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState(readTheme);
  const [fontSize, updateFontSize] = useState(readFontSize);
  const [storageError, setStorageError] = useState("");

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && media.matches),
      );
    };
    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useLayoutEffect(() => {
    document.documentElement.dataset.fontSize = fontSize;
    return () => {
      if (document.documentElement.dataset.fontSize === fontSize) {
        delete document.documentElement.dataset.fontSize;
      }
    };
  }, [fontSize]);

  function setTheme(next: Theme) {
    updateTheme(next);
    try {
      localStorage.setItem(storageKey, next);
      setStorageError("");
    } catch {
      setStorageError("主题已应用，但无法保存偏好，重启后可能恢复默认设置。");
    }
  }

  function setFontSize(next: FontSize) {
    updateFontSize(next);
    try {
      localStorage.setItem(fontSizeStorageKey, next);
      setStorageError("");
    } catch {
      setStorageError("字号已应用，但无法保存偏好，重启后可能恢复默认设置。");
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, fontSize, setFontSize, storageError }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
