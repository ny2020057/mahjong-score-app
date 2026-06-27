"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine
} from "recharts";
import { supabase } from "@/lib/supabase";

const RETURN_POINTS = 30000;
const INITIAL_POINTS = 25000;
const OKA = ((RETURN_POINTS - INITIAL_POINTS) * 4) / 1000;
const DEFAULT_NAMES = ["東家", "南家", "西家", "北家"];
const COLORS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24"];
const TABS = ["入力", "履歴", "統計"];

function calcPoints(s) { return Math.round((s - RETURN_POINTS) / 1000); }
function calcGameResult(entries) {
  const sorted = [...entries].map((e, i) => ({ ...e, idx: i })).sort((a, b) => b.score - a.score || a.idx - b.idx);
  const base = sorted.map((u, r) => {
    let p = calcPoints(u.score);
    if (r === 0) p += OKA;
    let uma = 0;
    if (r === 0) uma = 30;
    else if (r === 1) uma = 10;
    else if (r === 2) uma = -10;
    else if (r === 3) uma = -30;
    return { ...u, rank: r + 1, pts: p + uma };
  });
  const sumPts = base.reduce((acc, u) => acc + u.pts, 0);
  if (sumPts !== 0) {
    const topIdx = base.findIndex(u => u.rank === 1);
    if (topIdx !== -1) base[topIdx].pts -= sumPts;
  }
  const res = new Array(4);
  base.forEach(u => { res[u.idx] = { name: u.name, score: u.score, rank: u.rank, pts: u.pts }; });
  return res;
}

export default function MahjongApp() {
  const [activeTab, setActiveTab] = useState("入力");
  const [players, setPlayers] = useState(DEFAULT_NAMES);
  const [games, setGames] = useState([]);
  const [inputs, setInputs] = useState([{ score: "25000" }, { score: "25000" }, { score: "25000" }, { score: "25000" }]);
  const [gameDate, setGameDate] = useState(new Date().toISOString().split("T")[0]);
  const [gameNo, setGameNo] = useState("1");
  const [editPlayerIdx, setEditPlayerIdx] = useState(null);
  const [editPlayerName, setEditPlayerName] = useState("");
  const [loading, setLoading] = useState(true);

  // Supabaseからデータ（プレイヤー・対局履歴）を取得
  const fetchData = useCallback(async () => {
    // プレイヤー名取得
    const { data: stateData } = await supabase.from("app_state").select("*").eq("key", "players").single();
    if (stateData) setPlayers(stateData.value);

    // 履歴取得
    const { data: gamesData } = await supabase.from("games").select("*").order("game_date", { ascending: false }).order("game_no", { ascending: false });
    if (gamesData) {
      const formatted = gamesData.map(g => ({
        id: g.id,
        gameDate: g.game_date,
        gameNo: g.game_no,
        results: g.results
      }));
      setGames(formatted);
      if (formatted.length > 0) {
        const maxNo = Math.max(...formatted.filter(g => g.gameDate === gameDate).map(g => parseInt(g.gameNo) || 0), 0);
        setGameNo(String(maxNo + 1));
      }
    }
    setLoading(false);
  }, [gameDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // リアルタイム同期設定（誰かが更新したら一瞬で全員の画面に反映される）
  useEffect(() => {
    const channel = supabase.channel("schema-db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "games" }, () => { fetchData(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "app_state" }, () => { fetchData(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  // スコア保存
  const handleSave = async () => {
    const entries = inputs.map((inp, i) => ({ name: players[i], score: parseInt(inp.score) || 0 }));
    const total = entries.reduce((acc, e) => acc + e.score, 0);
    if (total !== 100000) {
      alert(`合計点数が ${total} です。100000点ちょうどにしてください。`);
      return;
    }
    const results = calcGameResult(entries);
    
    const { error } = await supabase.from("games").insert([{
      game_date: gameDate,
      game_no: parseInt(gameNo) || 1,
      results: results
    }]);

    if (!error) {
      setInputs([{ score: "25000" }, { score: "25000" }, { score: "25000" }, { score: "25000" }]);
      setActiveTab("履歴");
    } else {
      alert("保存に失敗しました。");
    }
  };

  // プレイヤー名変更
  const handleSavePlayerName = async () => {
    if (!editPlayerName.trim()) return;
    const next = [...players];
    next[editPlayerIdx] = editPlayerName.trim();
    
    const { error } = await supabase.from("app_state").upsert({ key: "players", value: next });
    if (!error) {
      setEditPlayerIdx(null);
    }
  };

  // 履歴削除
  const handleDeleteGame = async (id) => {
    if (!confirm("この対局結果を削除しますか？")) return;
    await supabase.from("games").delete().eq("id", id);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white font-sans text-sm animate-pulse">読み込み中…</div>;
  }

  // ─── 統計データ計算ロジック ───
  const statsMap = {};
  players.forEach(p => { statsMap[p] = { name: p, totalPts: 0, count: 0, ranks: [0, 0, 0, 0], scores: 0 }; });
  
  const timelineData = [];
  const reversedGames = [...games].reverse();
  const currentTotalPts = {};
  players.forEach(p => currentTotalPts[p] = 0);

  reversedGames.forEach((g, idx) => {
    const pointEntry = { name: `G${idx + 1}` };
    g.results.forEach(r => {
      if (statsMap[r.name]) {
        statsMap[r.name].totalPts += r.pts;
        statsMap[r.name].count += 1;
        statsMap[r.name].ranks[r.rank - 1] += 1;
        statsMap[r.name].scores += r.score;
        currentTotalPts[r.name] += r.pts;
      }
    });
    players.forEach(p => { pointEntry[p] = currentTotalPts[p]; });
    timelineData.push(pointEntry);
  });

  const rankDistData = [
    { name: "1位", ...Object.fromEntries(players.map(p => [p, statsMap[p]?.ranks[0] || 0])) },
    { name: "2位", ...Object.fromEntries(players.map(p => [p, statsMap[p]?.ranks[1] || 0])) },
    { name: "3位", ...Object.fromEntries(players.map(p => [p, statsMap[p]?.ranks[2] || 0])) },
    { name: "4位", ...Object.fromEntries(players.map(p => [p, statsMap[p]?.ranks[3] || 0])) },
  ];

  const summaryStats = players.map(p => {
    const s = statsMap[p];
    if (!s || s.count === 0) return { name: p, count: 0, avgRank: "–", top1Rate: "–", avgPts: "–", totalPts: 0 };
    const sumRanks = s.ranks.reduce((acc, c, i) => acc + c * (i + 1), 0);
    return {
      name: p,
      count: s.count,
      avgRank: (sumRanks / s.count).toFixed(2),
      top1Rate: ((s.ranks[0] / s.count) * 100).toFixed(1),
      avgPts: (s.totalPts / s.count).toFixed(1),
      totalPts: s.totalPts
    };
  }).sort((a, b) => b.totalPts - a.totalPts);

  return (
    <div className="max-w-xl mx-auto min-h-screen bg-slate-900 text-slate-100 flex flex-col shadow-2xl border-x border-slate-800/50 pb-12 font-sans">
      {/* ヘッダー */}
      <header className="sticky top-0 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-4 flex justify-between items-center z-40">
        <h1 className="text-xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">
          🀄 麻雀スコア管理
        </h1>
        <span className="text-[10px] bg-slate-800/80 border border-slate-700/50 text-slate-400 px-2.5 py-1 rounded-full font-bold">LIVE同期中</span>
      </header>

      {/* タブナビゲーション */}
      <nav className="px-4 mt-4">
        <div className="bg-slate-950/60 border border-slate-800/60 p-1 rounded-xl flex gap-1 shadow-inner">
          {TABS.map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`flex-1 text-center py-2.5 text-xs font-bold rounded-lg transition-all tracking-wide ${activeTab === t ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black shadow-md shadow-emerald-500/10" : "text-slate-400 hover:text-slate-200"}`}>
              {t}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 p-4">
        {/* タブ：入力 */}
        {activeTab === "入力" && (
          <section className="space-y-5">
            <div className="bg-slate-950/40 border border-slate-800/40 p-4 rounded-2xl flex gap-3 shadow-sm">
              <div className="flex-1">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">対局日</label>
                <input type="date" value={gameDate} onChange={(e) => setGameDate(e.target.value)}
                  className="w-full bg-slate-900/80 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 font-medium focus:outline-none focus:border-emerald-500 transition" />
              </div>
              <div className="w-24">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">戦目</label>
                <input type="number" value={gameNo} onChange={(e) => setGameNo(e.target.value)}
                  className="w-full bg-slate-900/80 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 font-medium text-center focus:outline-none focus:border-emerald-500 transition" />
              </div>
            </div>

            <div className="space-y-3">
              {inputs.map((inp, i) => (
                <div key={i} className="bg-slate-950/40 border border-slate-800/40 p-4 rounded-2xl flex items-center justify-between shadow-sm hover:border-slate-800 transition">
                  <div className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: COLORS[i] }} />
                    {editPlayerIdx === i ? (
                      <div className="flex gap-2">
                        <input type="text" value={editPlayerName} onChange={(e) => setEditPlayerName(e.target.value)}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white max-w-[100px]" />
                        <button onClick={handleSavePlayerName} className="text-xs bg-emerald-500 text-black px-2 py-1 rounded font-bold">保存</button>
                      </div>
                    ) : (
                      <span className="text-sm font-bold text-slate-200 cursor-pointer hover:text-emerald-400"
                            onClick={() => { setEditPlayerIdx(i); setEditPlayerName(players[i]); }}>
                        {players[i]} <span className="text-[10px] text-slate-600 font-normal ml-1">✏️</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" value={inp.score} placeholder="0"
                      onChange={(e) => {
                        const next = [...inputs];
                        next[i].score = e.target.value;
                        setInputs(next);
                      }}
                      className="w-32 bg-slate-900/80 border border-slate-800 rounded-xl px-4 py-2.5 text-right font-mono text-base font-bold text-slate-100 focus:outline-none focus:border-emerald-500 transition placeholder-slate-700" />
                    <span className="text-xs font-bold text-slate-600 font-mono w-4">点</span>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={handleSave}
              className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-slate-950 font-black py-4 rounded-2xl tracking-wider transition shadow-lg shadow-emerald-500/5 mt-2 text-sm">
              対局結果を確定
            </button>
          </section>
        )}

        {/* タブ：履歴 */}
        {activeTab === "履歴" && (
          <section className="space-y-3">
            {games.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs font-medium">対局履歴はありません</div>
            ) : (
              games.map((g) => (
                <div key={g.id} className="bg-slate-950/40 border border-slate-800/40 rounded-2xl p-4 shadow-sm relative group">
                  <div className="flex justify-between items-center mb-3 border-b border-slate-900 pb-2">
                    <span className="text-xs font-bold font-mono text-slate-400">{g.gameDate} ［{g.gameNo}戦目］</span>
                    <button onClick={() => handleDeleteGame(g.id)} className="text-xs text-red-400 hover:text-red-300 px-2 py-0.5 rounded bg-red-950/30 border border-red-900/30 font-medium">
                      削除
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {g.results.map((r, i) => (
                      <div key={i} className="flex justify-between items-center bg-slate-900/40 px-3 py-2 rounded-xl border border-slate-900/50">
                        <div className="flex items-center gap-2 min-w-0">
                          <RankBadge rank={r.rank} small />
                          <span className="text-xs font-bold text-slate-300 truncate">{r.name}</span>
                        </div>
                        <div className="text-right pl-2">
                          <div className="text-[10px] font-bold font-mono text-slate-500">{r.score.toLocaleString()}</div>
                          <div className={`text-xs font-black font-mono ${r.pts >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {r.pts >= 0 ? `+${r.pts}` : r.pts}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        )}

        {/* タブ：統計 */}
        {activeTab === "統計" && (
          <section className="space-y-6 pb-6">
            <div className="bg-slate-950/30 border border-slate-800/40 rounded-2xl p-4 shadow-sm">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4 border-l-2 border-emerald-500 pl-2">現在の総合ポイント</h3>
              <div className="space-y-2.5">
                {summaryStats.map((s, i) => (
                  <div key={s.name} className="flex justify-between items-center bg-slate-900/40 px-4 py-3 rounded-xl border border-slate-900/50">
                    <div className="flex items-center gap-3">
                      <span className={`w-5 h-5 rounded-md flex items-center justify-center text-xs font-black ${i === 0 ? "bg-amber-400/10 text-amber-400 border border-amber-400/20" : "bg-slate-800 text-slate-400"}`}>{i + 1}</span>
                      <span className="text-sm font-bold text-slate-200">{s.name}</span>
                    </div>
                    <span className={`text-sm font-mono font-black ${s.totalPts >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {s.totalPts >= 0 ? `+${s.totalPts}` : s.totalPts} <span className="text-[10px] text-slate-500 font-bold ml-0.5">pt</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {games.length > 0 && (
              <>
                <div className="bg-slate-950/30 border border-slate-800/40 rounded-2xl p-4 shadow-sm">
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4 border-l-2 border-emerald-500 pl-2">通算ポイント推移</h3>
                  <div className="w-full h-56 text-[10px] font-mono">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={timelineData} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="name" stroke="#64748b" />
                        <YAxis stroke="#64748b" />
                        <Tooltip contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", borderRadius: "12px", color: "#f8fafc" }} />
                        <Legend wrapperStyle={{ paddingTop: "10px" }} />
                        <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
                        {players.map((p, i) => (
                          <Line key={p} type="monotone" dataKey={p} stroke={COLORS[i]} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-slate-950/30 border border-slate-800/40 rounded-2xl p-4 shadow-sm">
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4 border-l-2 border-emerald-500 pl-2">順位分布</h3>
                  <div className="w-full h-56 text-[10px] font-mono">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={rankDistData} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="name" stroke="#64748b" />
                        <YAxis stroke="#64748b" allowDecimals={false} />
                        <Tooltip contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", borderRadius: "12px" }} />
                        <Legend wrapperStyle={{ paddingTop: "10px" }} />
                        {players.map((p, i) => (
                          <Bar key={p} dataKey={p} fill={COLORS[i]} radius={[4, 4, 0, 0]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}

            <div className="bg-slate-950/30 border border-slate-800/40 rounded-2xl p-4 shadow-sm">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4 border-l-2 border-emerald-500 pl-2">個人詳細スタッツ</h3>
              <div className="grid grid-cols-2 gap-3">
                {summaryStats.map((s, i) => (
                  <div key={s.name} className="bg-slate-900/30 border border-slate-800/40 rounded-xl p-3.5 relative overflow-hidden">
                    <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-900">
                      <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-xs font-bold text-white">{s.name}</span>
                    </div>
                    <div className="space-y-1">
                      <StatRow label="対局数" value={`${s.count}局`} />
                      <StatRow label="平均順位" value={s.count ? `${s.avgRank}位` : "–"} />
                      <StatRow label="1位率" value={s.count ? `${s.top1Rate}%` : "–"} />
                      <StatRow label="平均PT" value={s.count ? s.avgPts : "–"} color={s.count && parseFloat(s.avgPts) >= 0 ? "text-emerald-400" : "text-red-400"} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function RankBadge({ rank, small }) {
  const colors = { 1: "bg-amber-400 text-amber-900", 2: "bg-slate-400 text-slate-900", 3: "bg-amber-700 text-amber-100", 4: "bg-slate-700 text-slate-400" };
  const size = small ? "w-5 h-5 text-[10px]" : "w-6 h-6 text-xs";
  return <span className={`${size} rounded-full font-black flex items-center justify-center flex-shrink-0 ${colors[rank]}`}>{rank}</span>;
}

function StatRow({ label, value, color = "text-slate-300" }) {
  return (
    <div className="flex justify-between items-center text-[11px]">
      <span className="text-slate-500 font-bold">{label}</span>
      <span className={`font-mono font-bold ${color}`}>{value}</span>
    </div>
  );
}
