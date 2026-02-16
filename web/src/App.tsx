import { BrowserRouter, Routes, Route } from "react-router-dom"
import SessionList from "@/pages/SessionList"
import SessionDetail from "@/pages/SessionDetail"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SessionList />} />
        <Route path="/sessions/:id" element={<SessionDetail />} />
      </Routes>
    </BrowserRouter>
  )
}
