'use client';

import { createContext, useContext } from 'react';

const ThemeContext = createContext({ theme: 'dark' });

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }) {
  return (
    <ThemeContext.Provider value={{ theme: 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}
