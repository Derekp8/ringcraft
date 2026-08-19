import React, { useState } from 'react';
import { startMatch, stopMatch } from '../../core/matchManager';
import PostMatchSummary from './PostMatchSummary';
import { AIDifficulty } from '../../core/controllers/AIController';

export default function Menu() {
  const [numAI, setNumAI] = useState<number>(1);
  const [difficulty, setDifficulty] = useState<AIDifficulty>('medium');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleStart = () => {
    setRunning(true);
    setResult(null);
    startMatch({ numAI, difficulty, onEnd: (r: any) => { setResult(r); setRunning(false); } });
  };

  const handleStop = () => {
    stopMatch();
    setRunning(false);
  };

  return (
    <div className="menu">
      <h1>Play vs AI</h1>
      <div>
        <label>Number of AI opponents: </label>
        <input type="number" min={1} max={10} value={numAI} onChange={(e) => setNumAI(Number(e.target.value))} />
      </div>
      <div>
        <label>Difficulty: </label>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as AIDifficulty)}>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </div>
      <div style={{ marginTop: 12 }}>
        {!running ? (
          <button onClick={handleStart}>Start Match</button>
        ) : (
          <button onClick={handleStop}>Stop Match</button>
        )}
      </div>

      {result && <PostMatchSummary result={result} />}

      <p style={{ marginTop: 16, fontSize: 12 }}>
        Controls: WASD to move, Space to fire. Human input is broadcast to all owned avatars.
      </p>
    </div>
  );
}
