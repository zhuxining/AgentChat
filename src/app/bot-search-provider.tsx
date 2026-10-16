import { createContext, useContext, useState, type ReactNode } from "react";

type BotSearch = { search: string; setSearch: (value: string) => void };

const BotSearchContext = createContext<BotSearch | null>(null);

// Kept outside the Runner workspace so the Bot list keeps its query across layout
// changes and page navigation instead of resetting with a component instance.
export function BotSearchProvider({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState("");
  return (
    <BotSearchContext.Provider value={{ search, setSearch }}>{children}</BotSearchContext.Provider>
  );
}

export function useBotSearch(): BotSearch {
  const value = useContext(BotSearchContext);
  if (!value) throw new Error("useBotSearch 必须在 BotSearchProvider 内使用");
  return value;
}
