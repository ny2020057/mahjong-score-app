import "./globals.css";

export const metadata = {
  title: "麻雀スコア管理 share",
  description: "身内で共有できる麻雀スコア管理アプリ",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body className="bg-slate-900 text-slate-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
