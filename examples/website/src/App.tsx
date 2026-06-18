import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './components/Layout';
import Browse from './pages/Browse';
import Search from './pages/Search';
import Media from './pages/Media';
import Episodes from './pages/Episodes';
import Stream from './pages/Stream';

function ScrollToTop() {
  const { pathname, search } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname, search]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Browse />} />
          <Route path="/search" element={<Search />} />
          <Route path="/media" element={<Media />} />
          <Route path="/episodes" element={<Episodes />} />
          <Route path="/stream" element={<Stream />} />
        </Route>
      </Routes>
    </>
  );
}
