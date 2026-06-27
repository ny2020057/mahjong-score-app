import "./globals.css";

export const metadata = {
  title: "🀄 麻雀スコア管理 share",
  description: "身内で共有できる洗練された麻雀スコア管理アプリ",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja" className="dark">
      <body className="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased selection:bg-emerald-500/20">
        {children}
      </body>
    </html>
  );
}
