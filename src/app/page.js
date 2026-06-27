"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine
} from "recharts";
import { supabase } from "../lib/supabase";

const RETURN_POINTS = 30000;
const INITIAL_POINTS = 25000;
const OKA = ((RETURN_POINTS - INITIAL_POINTS) * 4) / 1000;
const DEFAULT_NAMES = ["東家", "南家", "西家", "北家"];
const COLORS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24"];
const TABS = ["入力", "履歴", "統計"];

function calcPoints(s) { return Math.round((s - RETURN_POINTS) / 1000); }
function calcGameResult(entries) {
  const sorted = [...entries].map((e, i) => ({ ...e, idx: i })).sort((a, b) => b.score - a.score || a.idx - b.idx);
  return entries.map((e, i) => {
    const rank = sorted.findIndex(s => s.idx === i) + 1;
    let pts = calcPoints(e.score);
    if (rank === 1) pts += OKA;
    return { name: e.name, score: e.score, rank, pts };
  });
}
function toDateStr(iso) { return iso.slice(0, 10); }
function formatDate(d) { const [y, m, dd] = d.split("-"); return `${y}年${parseInt(m)}月${parseInt(dd)}日`; }
function todayStr() { return new Date().toLocaleDateString("sv-SE"); }

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState(0);
  const [players, setPlayers] = useState(DEFAULT_NAMES);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    // プレイヤー名の取得
    const { data: stateData } = await supabase.from("app_state").select("*").eq("key", "players").single();
    if (stateData) setPlayers(stateData.value);

    // 対局履歴の取得
    const { data: gamesData } = await supabase.from("games").select("*").order("game_date", { ascending: false }).order("game_no", { ascending: false });
    if (gamesData) {
      const formatted = gamesData.map(g => ({
        id: g.id,
        timestamp: g.created_at,
        gameDate: g.game_date,
        gameNo: g.game_no,
        results: g.results
      }));
      setGames(formatted);
    }
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // リアルタイム同期（他の端末での入力も一瞬で反映）
  useEffect(() => {
    const channel = supabase.channel("schema-db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "games" }, () => { reload(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "app_state" }, () => { reload(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [reload]);

  const addGame = async (game) => {
    setSyncing(true);
    const { error } = await supabase.from("games").insert([{
      game_date: game.gameDate,
      game_no: game.gameNo,
      results: game.results
    }]);
    if (!error) await reload();
    setSyncing(false);
  };

  const deleteGame = async (id) => {
    setSyncing(true);
    const { error } = await supabase.from("games").delete().eq("id", id);
    if (!error) await reload();
    setSyncing(false);
  };

  const updateGame = async (updated) => {
    setSyncing(true);
    const { error } = await supabase.from("games").update({
      game_date: updated.gameDate,
      game_no: updated.gameNo,
      results: updated.results
    }).eq("id", updated.id);
    if (!error) await reload();
    setSyncing(false);
  };

  const updatePlayers = async (names) => {
    setSyncing(true);
    setPlayers(names);
    await supabase.from("app_state").upsert({ key: "players", value: names });
    setSyncing(false);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <p className="text-slate-400 text-sm tracking-widest animate-pulse">読み込み中…</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur border-b border-slate-800">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🀄</span>
            <h1 className="text-base font-bold tracking-wide text-white">麻雀スコア</h1>
          </div>
          {syncing && <span className="text-xs text-amber-400 animate-pulse">同期中…</span>}
        </div>
        <div className="max-w-xl mx-auto px-4 flex gap-1 pb-2">
          {TABS.map((t, i) => (
            <button key={t} onClick={() => setTab(i)}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === i ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>
              {t}
            </button>
          ))}
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 py-6 pb-20">
        {tab === 0 && <InputTab players={players} onUpdatePlayers={updatePlayers} onAddGame={addGame} games={games} />}
        {tab === 1 && <HistoryTab games={games} onDeleteGame={deleteGame} onUpdateGame={updateGame} />}
        {tab === 2 && <StatsTab games={games} players={players} />}
      </main>
    </div>
  );
}

// ─── Input Tab ────────────────────────────────────────────────────────────────
function InputTab({ players, onUpdatePlayers, onAddGame, games }) {
  const [scores, setScores] = useState(["", "", "", ""]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [editNames, setEditNames] = useState(false);
  const [nameEdits, setNameEdits] = useState([...players]);
  const [saved, setSaved] = useState(false);
  const [gameDate, setGameDate] = useState(todayStr());
  const [gameNo, setGameNo] = useState("");

  useEffect(() => {
    const sameDay = games.filter(g => (g.gameDate || toDateStr(g.timestamp)) === gameDate);
    setGameNo(String(sameDay.reduce((m, g) => Math.max(m, g.gameNo || 0), 0) + 1));
  }, [gameDate, games]);

  useEffect(() => {
    const nums = scores.map(s => parseInt(s, 10));
    if (nums.some(isNaN)) { setPreview(null); setError(""); return; }
    const total = nums.reduce((a, b) => a + b, 0);
    if (total !== 100000) { setPreview(null); setError(`合計 ${total.toLocaleString()} 点（100,000点になるよう入力してください）`); return; }
    setError("");
    setPreview(calcGameResult(players.map((name, i) => ({ name, score: nums[i] }))));
  }, [scores, players]);

  const handleSave = async () => {
    if (!preview) return;
    const no = parseInt(gameNo, 10);
    if (!gameDate || isNaN(no) || no < 1) { setError("対局日と試合番号を正しく入力してください"); return; }
    await onAddGame({ id: Date.now().toString(), timestamp: new Date().toISOString(), gameDate, gameNo: no, results: preview });
    setScores(["", "", "", ""]);
    setPreview(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-5">
      <section className="bg-slate-900 rounded-xl p-4 border border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">プレイヤー名</h2>
          {!editNames
            ? <button onClick={() => { setNameEdits([...players]); setEditNames(true); }} className="text-xs text-emerald-400 hover:text-emerald-300">編集</button>
            : <div className="flex gap-2">
                <button onClick={async () => { await onUpdatePlayers(nameEdits); setEditNames(false); }} className="text-xs text-emerald-400 hover:text-emerald-300">保存</button>
                <button onClick={() => setEditNames(false)} className="text-xs text-slate-500 hover:text-slate-400">キャンセル</button>
              </div>
          }
        </div>
        <div className="grid grid-cols-2 gap-2">
          {players.map((name, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-slate-700 text-xs flex items-center justify-center text-slate-400">{i + 1}</span>
              {editNames
                ? <input value={nameEdits[i]} onChange={e => { const n = [...nameEdits]; n[i] = e.target.value; setNameEdits(n); }}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-emerald-500" />
                : <span className="text-sm text-white">{name}</span>
              }
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-900 rounded-xl p-4 border border-slate-800">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">対局情報</h2>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-slate-500 mb-1 block">対局日</label>
            <input type="date" value={gameDate} onChange={e => setGameDate(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              style={{ colorScheme: "dark" }} />
          </div>
          <div className="w-24">
            <label className="text-xs text-slate-500 mb-1 block">試合番号</label>
            <input type="number" min="1" value={gameNo} onChange={e => setGameNo(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 text-center" />
            <p className="text-xs text-slate-600 mt-1 text-center">試合目</p>
          </div>
        </div>
      </section>

      <section className="bg-slate-900 rounded-xl p-4 border border-slate-800">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">最終点数を入力</h2>
        <div className="space-y-2">
          {players.map((name, i) => (
            <div key={i} className="flex items-center gap-3">
              <label className="w-16 text-sm text-slate-400 truncate">{name}</label>
              <input type="number" placeholder="例: 35600" value={scores[i]}
                onChange={e => { const n = [...scores]; n[i] = e.target.value; setScores(n); }}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500" />
            </div>
          ))}
        </div>
        {error && <p className="mt-3 text-xs text-red-400 bg-red-950/40 rounded-lg px-3 py-2">{error}</p>}
      </section>

      {preview && (
        <section className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">プレビュー</h2>
            <span className="text-xs text-slate-500">{formatDate(gameDate)} 第{gameNo}試合</span>
          </div>
          <div className="divide-y divide-slate-800">
            {[...preview].sort((a, b) => a.rank - b.rank).map(r => (
              <div key={r.name} className="flex items-center gap-3 px-4 py-3">
                <RankBadge rank={r.rank} />
                <span className="flex-1 text-sm text-white">{r.name}</span>
                <span className="text-sm text-slate-400">{r.score.toLocaleString()}点</span>
                <span className={`text-sm font-bold w-14 text-right ${r.pts >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {r.pts >= 0 ? `+${r.pts}` : r.pts}
                </span>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-slate-800">
            <button onClick={handleSave}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg py-2.5 transition-colors">
              {saved ? "✓ 保存しました" : "対局を確定する"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── History Tab ──────────────────────────────────────────────────────────────
function HistoryTab({ games, onDeleteGame, onUpdateGame }) {
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedGame, setSelectedGame] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (selectedGame) {
      const latest = games.find(g => g.id === selectedGame.id);
      if (latest) setSelectedGame(latest);
      else { setSelectedGame(null); setEditing(false); }
    }
  }, [games]);

  const byDate = {};
  games.forEach(g => {
    const d = g.gameDate || toDateStr(g.timestamp);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(g);
  });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  if (games.length === 0) return (
    <div className="text-center py-16 text-slate-600">
      <p className="text-4xl mb-3">🀄</p>
      <p className="text-sm">対局履歴がありません</p>
    </div>
  );

  if (selectedGame && editing) {
    return (
      <EditGameView
        game={selectedGame}
        onSave={async (updated) => { await onUpdateGame(updated); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  if (selectedGame) {
    const g = selectedGame;
    const d = g.gameDate || toDateStr(g.timestamp);
    return (
      <div className="space-y-4">
        <nav className="flex items-center gap-2 text-sm">
          <button onClick={() => setSelectedGame(null)} className="text-emerald-400 hover:text-emerald-300">{formatDate(d)}</button>
          <span className="text-slate-600">›</span>
          <span className="text-slate-300">第{g.gameNo}試合</span>
        </nav>
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">{formatDate(d)} 第{g.gameNo}試合</p>
              <p className="text-xs text-slate-600 mt-0.5">
                {new Date(g.timestamp).toLocaleString("ja-JP", { hour: "2-digit", minute: "2-digit" })} 登録
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setEditing(true)}
                className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">編集</button>
              <button onClick={async () => { if(confirm("この対局結果を削除しますか？")) { await onDeleteGame(g.id); setSelectedGame(null); } }}
                className="text-xs text-slate-600 hover:text-red-400 transition-colors">削除</button>
            </div>
          </div>
          <div className="divide-y divide-slate-800/60">
            {[...g.results].sort((a, b) => a.rank - b.rank).map(r => (
              <div key={r.name} className="flex items-center gap-3 px-4 py-3">
                <RankBadge rank={r.rank} />
                <span className="flex-1 text-sm text-white">{r.name}</span>
                <span className="text-sm text-slate-400">{r.score.toLocaleString()}点</span>
                <span className={`text-sm font-bold w-14 text-right ${r.pts >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {r.pts >= 0 ? `+${r.pts}` : r.pts}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (selectedDate) {
    const dayGames = [...(byDate[selectedDate] || [])].sort((a, b) => (a.gameNo || 0) - (b.gameNo || 0));
    return (
      <div className="space-y-4">
        <nav className="flex items-center gap-2 text-sm">
          <button onClick={() => setSelectedDate(null)} className="text-emerald-400 hover:text-emerald-300">対局日一覧</button>
          <span className="text-slate-600">›</span>
          <span className="text-slate-300">{formatDate(selectedDate)}</span>
        </nav>
        <p className="text-xs text-slate-500">{dayGames.length}試合</p>
        <div className="space-y-2">
          {dayGames.map(g => {
            const winner = g.results.find(r => r.rank === 1);
            return (
              <button key={g.id} onClick={() => setSelectedGame(g)}
                className="w-full bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-800 hover:border-slate-700 px-4 py-3 flex items-center gap-3 transition-colors text-left">
                <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-white">{g.gameNo}</span>
                  <span className="text-xs text-slate-500 ml-0.5">戦</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium">第{g.gameNo}試合</p>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">🥇 {winner?.name} {winner?.score?.toLocaleString()}点</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-slate-600">{new Date(g.timestamp).toLocaleString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</p>
                  <p className="text-slate-600 text-xs mt-1">›</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">{dates.length}日分の記録</p>
      {dates.map(d => {
        const dayGames = byDate[d];
        const playerMap = {};
        dayGames.forEach(g => g.results.forEach(r => { playerMap[r.name] = (playerMap[r.name] || 0) + r.pts; }));
        const top = Object.entries(playerMap).sort((a, b) => b[1] - a[1])[0];
        return (
          <button key={d} onClick={() => setSelectedDate(d)}
            className="w-full bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-800 hover:border-slate-700 px-4 py-3.5 flex items-center gap-3 transition-colors text-left">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">{formatDate(d)}</p>
              <p className="text-xs text-slate-500 mt-1">{dayGames.length}試合</p>
            </div>
            {top && (
              <div className="text-right flex-shrink-0">
                <p className="text-xs text-slate-400">トップ</p>
                <p className="text-sm font-bold text-emerald-400">{top[0]}</p>
                <p className="text-xs text-emerald-600">{top[1] >= 0 ? `+${top[1]}` : top[1]}pt</p>
              </div>
            )}
            <span className="text-slate-600 text-sm ml-1">›</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Edit Game View ───────────────────────────────────────────────────────────
function EditGameView({ game, onSave, onCancel }) {
  const d = game.gameDate || toDateStr(game.timestamp);
  const [gameDate, setGameDate] = useState(game.gameDate || toDateStr(game.timestamp));
  const [gameNo, setGameNo] = useState(String(game.gameNo || ""));
  const [scores, setScores] = useState(game.results.map(r => String(r.score)));
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const names = game.results.map(r => r.name);

  useEffect(() => {
    const nums = scores.map(s => parseInt(s, 10));
    if (nums.some(isNaN)) { setPreview(null); setError(""); return; }
    const total = nums.reduce((a, b) => a + b, 0);
    if (total !== 100000) { setPreview(null); setError(`合計 ${total.toLocaleString()} 点（100,000点になるよう入力してください）`); return; }
    setError("");
    setPreview(calcGameResult(names.map((name, i) => ({ name, score: nums[i] }))));
  }, [scores]);

  const handleSave = async () => {
    if (!preview) return;
    const no = parseInt(gameNo, 10);
    if (!gameDate || isNaN(no) || no < 1) { setError("対局日と試合番号を正しく入力してください"); return; }
    setSaving(true);
    await onSave({ ...game, gameDate, gameNo: no, results: preview });
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-2 text-sm">
        <button onClick={onCancel} className="text-emerald-400 hover:text-emerald-300">{formatDate(d)}</button>
        <span className="text-slate-600">›</span>
        <span className="text-slate-300">第{game.gameNo}試合</span>
        <span className="text-slate-600">›</span>
        <span className="text-amber-400">編集中</span>
      </nav>

      <section className="bg-slate-900 rounded-xl p-4 border border-amber-800/40">
        <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider mb-3">対局情報を編集</h2>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-slate-500 mb-1 block">対局日</label>
            <input type="date" value={gameDate} onChange={e => setGameDate(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
              style={{ colorScheme: "dark" }} />
          </div>
          <div className="w-24">
            <label className="text-xs text-slate-500 mb-1 block">試合番号</label>
            <input type="number" min="1" value={gameNo} onChange={e => setGameNo(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 text-center" />
            <p className="text-xs text-slate-600 mt-1 text-center">試合目</p>
          </div>
        </div>
      </section>

      <section className="bg-slate-900 rounded-xl p-4 border border-amber-800/40">
        <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider mb-3">最終点数を修正</h2>
        <div className="space-y-2">
          {names.map((name, i) => (
            <div key={i} className="flex items-center gap-3">
              <label className="w-16 text-sm text-slate-400 truncate">{name}</label>
              <input type="number" value={scores[i]}
                onChange={e => { const n = [...scores]; n[i] = e.target.value; setScores(n); }}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
            </div>
          ))}
        </div>
        {error && <p className="mt-3 text-xs text-red-400 bg-red-950/40 rounded-lg px-3 py-2">{error}</p>}
      </section>

      {preview && (
        <section className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">修正後プレビュー</h2>
          </div>
          <div className="divide-y divide-slate-800">
            {[...preview].sort((a, b) => a.rank - b.rank).map(r => (
              <div key={r.name} className="flex items-center gap-3 px-4 py-3">
                <RankBadge rank={r.rank} />
                <span className="flex-1 text-sm text-white">{r.name}</span>
                <span className="text-sm text-slate-400">{r.score.toLocaleString()}点</span>
                <span className={`text-sm font-bold w-14 text-right ${r.pts >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {r.pts >= 0 ? `+${r.pts}` : r.pts}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex gap-3">
        <button onClick={onCancel}
          className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold rounded-lg py-2.5 transition-colors">
          キャンセル
        </button>
        <button onClick={handleSave} disabled={!preview || saving}
          className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg py-2.5 transition-colors">
          {saving ? "保存中…" : "変更を保存"}
        </button>
      </div>
    </div>
  );
}

// ─── Stats Tab ────────────────────────────────────────────────────────────────
function StatsTab({ games, players }) {
  if (games.length === 0) return (
    <div className="text-center py-16 text-slate-600">
      <p className="text-4xl mb-3">📊</p>
      <p className="text-sm">まだ対局データがありません</p>
    </div>
  );

  const stats = players.map(name => {
    const participated = games.filter(g => g.results.some(r => r.name === name));
    const count = participated.length;
    if (count === 0) return { name, count: 0, avgRank: "-", top1Rate: "-", avgPts: "-", totalPts: 0 };
    const results = participated.map(g => g.results.find(r => r.name === name));
    const totalPts = results.reduce((a, r) => a + r.pts, 0);
    return {
      name, count,
      avgRank: (results.reduce((a, r) => a + r.rank, 0) / count).toFixed(1),
      top1Rate: ((results.filter(r => r.rank === 1).length / count) * 100).toFixed(0),
      avgPts: (totalPts / count).toFixed(1),
      totalPts,
    };
  });

  const rankingData = [...stats].sort((a, b) => b.totalPts - a.totalPts).map((s, i) => ({ ...s, rankNum: i + 1 }));
  const reversedGames = [...games].reverse();
  const lineData = reversedGames.map((game, gi) => {
    const pt = { game: `${gi + 1}` };
    players.forEach(name => {
      let cum = 0;
      for (let j = 0; j <= gi; j++) {
        const r = reversedGames[j].results.find(r => r.name === name);
        if (r) cum += r.pts;
      }
      pt[name] = cum;
    });
    return pt;
  });

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">累計ランキング</h2>
        <div className="space-y-2">
          {rankingData.map(s => (
            <div key={s.name} className="bg-slate-900 rounded-xl border border-slate-800 px-4 py-3 flex items-center gap-3">
              <RankBadge rank={s.rankNum} />
              <span className="flex-1 text-sm text-white font-medium">{s.name}</span>
              <div className="text-right">
                <p className={`text-lg font-bold ${s.totalPts >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {s.totalPts >= 0 ? `+${s.totalPts}` : s.totalPts}
                </p>
                <p className="text-xs text-slate-600">{s.count}局</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">累計ポイント比較</h2>
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-3">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rankingData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                labelStyle={{ color: "#e2e8f0" }} itemStyle={{ color: "#94a3b8" }} />
              <ReferenceLine y={0} stroke="#475569" />
              <Bar dataKey="totalPts" name="累計PT" fill="#34d399" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {reversedGames.length >= 2 && (
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">累計ポイント推移</h2>
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-3">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={lineData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="game" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                  labelStyle={{ color: "#e2e8f0" }} itemStyle={{ color: "#94a3b8" }} />
                <ReferenceLine y={0} stroke="#475569" />
                <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                {players.map((name, i) => (
                  <Line key={name} type="monotone" dataKey={name} stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">個人詳細</h2>
        <div className="grid grid-cols-2 gap-3">
          {stats.map((s, i) => (
            <div key={s.name} className="bg-slate-900 rounded-xl border border-slate-800 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="text-sm font-semibold text-white">{s.name}</span>
              </div>
              <div className="space-y-1.5">
                <StatRow label="対局数" value={`${s.count}局`} />
                <StatRow label="平均順位" value={s.count ? `${s.avgRank}位` : "–"} />
                <StatRow label="1位率" value={s.count ? `${s.top1Rate}%` : "–"} />
                <StatRow label="平均PT" value={s.count ? s.avgPts : "–"}
                  color={s.count && parseFloat(s.avgPts) >= 0 ? "text-emerald-400" : "text-red-400"} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────
function RankBadge({ rank, small }) {
  const colors = { 1: "bg-amber-400 text-amber-900", 2: "bg-slate-400 text-slate-900", 3: "bg-amber-700 text-amber-100", 4: "bg-slate-700 text-slate-400" };
  const size = small ? "w-5 h-5 text-xs" : "w-6 h-6 text-xs";
  return <span className={`${size} rounded-full font-bold flex items-center justify-center flex-shrink-0 ${colors[rank] || "bg-slate-700 text-slate-400"}`}>{rank}</span>;
}
function StatRow({ label, value, color }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-xs font-semibold ${color || "text-slate-200"}`}>{value}</span>
    </div>
  );
}
