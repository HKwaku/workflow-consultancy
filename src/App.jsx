import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Diagnostic from './pages/Diagnostic';
import Portal from './pages/Portal';
import Report from './pages/Report';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="diagnostic" element={<Diagnostic />} />
        <Route path="portal" element={<Portal />} />
        <Route path="report" element={<Report />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
