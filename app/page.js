"use client";
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  where,
  updateDoc,
  doc,
} from "firebase/firestore";

const CANVAS_SIZE = 400;
const SCALE = 20;

const INITIAL_SPEED = 150;
const SPEED_INCREMENT_INTERVAL = 5;
const SPEED_DECREMENT_AMOUNT = 10;

const generateRandomId = () => crypto.randomUUID();

function App() {
  const firebaseApp = useMemo(() => {
    const firebaseConfig = {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    };

    if (
      !firebaseConfig.apiKey ||
      !firebaseConfig.projectId ||
      !firebaseConfig.authDomain
    ) {
      console.error(
        "Firebase Initialization Error: Missing essential Firebase configuration details from environment variables. Please check your .env.local file."
      );
      return null;
    }

    if (!getApps().length) {
      return initializeApp(firebaseConfig);
    } else {
      return getApp();
    }
  }, []);

  const auth = useMemo(
    () => (firebaseApp ? getAuth(firebaseApp) : null),
    [firebaseApp]
  );
  const db = useMemo(
    () => (firebaseApp ? getFirestore(firebaseApp) : null),
    [firebaseApp]
  );

  const appId =
    process.env.NEXT_PUBLIC_APP_ID ||
    (firebaseApp ? firebaseApp.options.appId : "default-app-id");

  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    console.log("Firebase Auth instance:", auth);
    console.log("Firebase Firestore instance:", db);

    if (!auth || !db) {
      console.error(
        "Firebase Auth or DB not initialized. Please check your .env.local variables and Firebase setup."
      );
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
      } else {
        try {
          await signInAnonymously(auth);
          setUserId(auth.currentUser?.uid || generateRandomId());
        } catch (error) {
          console.error("Error signing in anonymously:", error);
          setUserId(generateRandomId());
        }
      }
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, [auth, db]);

  const [currentPage, setCurrentPage] = useState("menu");
  const [username, setUsername] = useState("");
  const [score, setScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [lastScore, setLastScore] = useState(null);

  const canvasRef = useRef(null);
  const gameLoopRef = useRef(null);
  const snakeRef = useRef([{ x: 0, y: 0 }]);
  const foodRef = useRef({ x: 0, y: 0 });
  const dxRef = useRef(SCALE);
  const dyRef = useRef(0);
  const scoreRef = useRef(0);
  const gameStartedRef = useRef(false);
  const speedRef = useRef(INITIAL_SPEED);

  useEffect(() => {
    const storedUsername = localStorage.getItem("snakeGameUsername");
    if (storedUsername) {
      setUsername(storedUsername);
    }

    if (localStorage.getItem("snakeGameInProgress") === "true") {
      setCurrentPage("menu");
      localStorage.removeItem("snakeGameInProgress");
    }
  }, []);

  useEffect(() => {
    if (username) {
      localStorage.setItem("snakeGameUsername", username);
    }
  }, [username]);

  useEffect(() => {
    if (!isAuthReady || !db) return;

    const leaderboardCollectionPath = `artifacts/${appId}/public/data/leaderboard`;
    const q = query(
      collection(db, leaderboardCollectionPath),
      orderBy("score", "desc"),
      limit(10)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setLeaderboard(data);
      },
      (error) => {
        console.error("Error fetching leaderboard:", error);
      }
    );

    return () => unsubscribe();
  }, [isAuthReady, db, userId, appId]);

  const generateFood = useCallback(() => {
    const maxX = CANVAS_SIZE / SCALE;
    const maxY = CANVAS_SIZE / SCALE;
    let newFood = {
      x: Math.floor(Math.random() * maxX) * SCALE,
      y: Math.floor(Math.random() * maxY) * SCALE,
    };

    while (
      snakeRef.current.some(
        (segment) => segment.x === newFood.x && segment.y === newFood.y
      )
    ) {
      newFood = {
        x: Math.floor(Math.random() * maxX) * SCALE,
        y: Math.floor(Math.random() * maxY) * SCALE,
      };
    }
    foodRef.current = newFood;
  }, []);

  const draw = useCallback((ctx) => {
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    ctx.fillStyle = "#4CAF50";
    snakeRef.current.forEach((segment) => {
      ctx.fillRect(segment.x, segment.y, SCALE, SCALE);
      ctx.strokeStyle = "#388E3C";
      ctx.strokeRect(segment.x, segment.y, SCALE, SCALE);
    });

    ctx.fillStyle = "#F44336";
    ctx.beginPath();
    ctx.arc(
      foodRef.current.x + SCALE / 2,
      foodRef.current.y + SCALE / 2,
      SCALE / 2,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }, []);

  const checkCollision = useCallback((head) => {
    if (
      head.x < 0 ||
      head.x >= CANVAS_SIZE ||
      head.y < 0 ||
      head.y >= CANVAS_SIZE
    ) {
      return true;
    }

    for (let i = 1; i < snakeRef.current.length; i++) {
      if (
        head.x === snakeRef.current[i].x &&
        head.y === snakeRef.current[i].y
      ) {
        return true;
      }
    }
    return false;
  }, []);

  const submitScore = useCallback(
    async (finalScore) => {
      if (!db || !userId || !username) {
        console.error(
          "Firestore not ready or user/username missing for score submission. Score not submitted."
        );
        return;
      }
      try {
        const leaderboardCollectionPath = `artifacts/${appId}/public/data/leaderboard`;
        const leaderboardRef = collection(db, leaderboardCollectionPath);

        const q = query(
          leaderboardRef,
          where("userId", "==", userId),
          limit(1)
        );
        const querySnapshot = await getDocs(q);

        let existingDoc = null;
        let existingScore = 0;

        if (!querySnapshot.empty) {
          existingDoc = querySnapshot.docs[0];
          existingScore = existingDoc.data().score || 0;
        }

        if (existingDoc && finalScore > existingScore) {
          await updateDoc(existingDoc.ref, {
            username: username,
            score: finalScore,
            timestamp: Date.now(),
          });
          console.log("Score updated successfully for existing user!");
        } else if (!existingDoc) {
          await addDoc(leaderboardRef, {
            username: username,
            score: finalScore,
            timestamp: Date.now(),
            userId: userId,
          });
          console.log("New score added successfully!");
        } else {
          console.log(
            "Current score is not higher than the existing best score for this user. Score not updated."
          );
        }
      } catch (e) {
        console.error("Error submitting or updating score: ", e);
      }
    },
    [db, userId, username, appId]
  );

  const endGame = useCallback(() => {
    gameStartedRef.current = false;
    clearInterval(gameLoopRef.current);
    setLastScore(scoreRef.current);
    setCurrentPage("menu");
    localStorage.removeItem("snakeGameInProgress");

    submitScore(scoreRef.current);
  }, [submitScore]);

  const update = useCallback(() => {
    const head = {
      x: snakeRef.current[0].x + dxRef.current,
      y: snakeRef.current[0].y + dyRef.current,
    };

    if (checkCollision(head)) {
      endGame();
      return;
    }

    snakeRef.current.unshift(head);

    if (head.x === foodRef.current.x && head.y === foodRef.current.y) {
      scoreRef.current += 1;
      setScore(scoreRef.current);
      generateFood();

      if (
        scoreRef.current > 0 &&
        scoreRef.current % SPEED_INCREMENT_INTERVAL === 0
      ) {
        speedRef.current = Math.max(
          50,
          speedRef.current - SPEED_DECREMENT_AMOUNT
        );
        clearInterval(gameLoopRef.current);
        gameLoopRef.current = setInterval(update, speedRef.current);
      }
    } else {
      snakeRef.current.pop();
    }

    const ctx = canvasRef.current.getContext("2d");
    draw(ctx);
  }, [checkCollision, endGame, generateFood, draw]);

  const startGame = useCallback(() => {
    snakeRef.current = [{ x: 0, y: 0 }];
    dxRef.current = SCALE;
    dyRef.current = 0;
    scoreRef.current = 0;
    setScore(0);
    speedRef.current = INITIAL_SPEED;
    generateFood();
    gameStartedRef.current = true;
    localStorage.setItem("snakeGameInProgress", "true");

    if (gameLoopRef.current) {
      clearInterval(gameLoopRef.current);
    }
    gameLoopRef.current = setInterval(update, speedRef.current);
  }, [generateFood, update]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!gameStartedRef.current) return;

      const keyPressed = e.key;

      if (keyPressed === "ArrowLeft" && dxRef.current === 0) {
        dxRef.current = -SCALE;
        dyRef.current = 0;
      } else if (keyPressed === "ArrowUp" && dyRef.current === 0) {
        dxRef.current = 0;
        dyRef.current = -SCALE;
      } else if (keyPressed === "ArrowRight" && dxRef.current === 0) {
        dxRef.current = SCALE;
        dyRef.current = 0;
      } else if (keyPressed === "ArrowDown" && dyRef.current === 0) {
        dxRef.current = 0;
        dyRef.current = SCALE;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-800 to-indigo-900 text-white font-inter flex flex-col items-center justify-center p-4">
      <style>
        {`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');
                body { font-family: 'Inter', sans-serif; }
                .btn {
                    padding: 0.75rem 1.5rem;
                    border-radius: 0.5rem;
                    font-weight: bold;
                    transition: all 0.2s ease-in-out;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                    text-shadow: 0 1px 2px rgba(0,0,0,0.2);
                    border: none; 
                }
                .btn:active {
                    transform: translateY(0); 
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); 
                }
                .btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 8px rgba(0, 0, 0, 0.2);
                }
                .btn-primary {
                    background-image: linear-gradient(to right, #6366F1, #4F46E5); 
                    color: white;
                }
                .btn-primary:hover {
                    background-image: linear-gradient(to right, #4F46E5, #3730A3); 
                }
                .btn-secondary {
                    background-image: linear-gradient(to right, #EC4899, #DB2777); 
                    color: white;
                }
                .btn-secondary:hover {
                    background-image: linear-gradient(to right, #DB2777, #BE185D); 
                }
                .input-field {
                    padding: 0.75rem 1rem;
                    border-radius: 0.5rem;
                    border: 1px solid #CBD5E0;
                    background-color: #FFF;
                    color: #333;
                    width: 100%;
                }
                .input-field:focus {
                    outline: none;
                    border-color: #6366F1;
                    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
                }
                .game-container {
                    background-color: #333;
                    border: 8px solid #4CAF50;
                    border-radius: 12px;
                    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.5);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding: 20px;
                }
                canvas {
                    background-color: #1A202C;
                    border-radius: 8px;
                    display: block;
                    width: ${CANVAS_SIZE}px; 
                    height: ${CANVAS_SIZE}px; 
                    box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5);
                    margin-bottom: 20px; 
                }
                `}
      </style>

      <h1 className="text-5xl font-bold mb-8 text-transparent bg-clip-text bg-gradient-to-r from-green-300 to-blue-400 text-center">
        SNAKE GAME
      </h1>

      {currentPage === "menu" && (
        <div className="flex flex-col items-center p-8 bg-gray-800 rounded-lg shadow-lg max-w-md w-full">
          <h2 className="text-3xl font-semibold mb-6 text-white text-center">
            Menu
          </h2>

          <div className="mb-6 w-full">
            <label
              htmlFor="username"
              className="block text-lg font-medium text-gray-300 mb-2"
            >
              Your Username:
            </label>
            <input
              id="username"
              type="text"
              className="input-field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your name"
            />
          </div>

          {lastScore !== null && (
            <p className="text-xl text-yellow-300 mb-4 animate-bounce text-center">
              Your Last Score: {lastScore}
            </p>
          )}

          <button
            onClick={() => {
              if (username.trim()) {
                setCurrentPage("game");
                startGame();
              } else {
                const errorMessage = document.createElement("div");
                errorMessage.className =
                  "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50";
                errorMessage.innerHTML = `
                    <div class="bg-gray-800 p-6 rounded-lg shadow-xl text-white text-center flex flex-col items-center">
                        <p class="text-xl mb-4">Please enter a username to play!</p>
                        <button class="btn btn-primary px-6 py-2" onclick="this.closest('.fixed').remove()">OK</button>
                    </div>
                `;
                document.body.appendChild(errorMessage);
              }
            }}
            className="btn btn-primary w-full mb-4 text-xl"
          >
            Play Game
          </button>

          <h3 className="text-2xl font-semibold mt-8 mb-4 text-white text-center">
            Leaderboard (Top 10)
          </h3>
          <div className="w-full bg-gray-700 rounded-md p-4 max-h-60 overflow-y-auto custom-scrollbar">
            {leaderboard.length === 0 ? (
              <p className="text-gray-400 text-center">
                Loading leaderboard...
              </p>
            ) : (
              <table className="min-w-full text-left text-sm font-light">
                <thead className="border-b border-gray-600 font-medium sticky top-0 bg-gray-700">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-gray-300">
                      #
                    </th>
                    <th scope="col" className="px-4 py-2 text-gray-300">
                      Username
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-gray-300 text-right"
                    >
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, index) => (
                    <tr
                      key={entry.id}
                      className="border-b border-gray-600 transition duration-150 ease-in-out hover:bg-gray-600"
                    >
                      <td className="whitespace-nowrap px-4 py-2 font-medium">
                        {index + 1}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {entry.username}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        {entry.score}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {userId && (
            <p className="text-xs text-gray-500 mt-4 text-center">
              Your User ID: {userId}
            </p>
          )}
        </div>
      )}

      {currentPage === "game" && (
        <div className="game-container">
          <h2 className="text-3xl font-semibold mb-4 text-white">
            Score: {score}
          </h2>
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
          ></canvas>

          <div className="mt-6 flex flex-col sm:flex-row gap-4 w-full justify-center">
            <button onClick={endGame} className="btn btn-secondary text-xl">
              End Game
            </button>
          </div>
          <p className="text-gray-400 text-sm mt-4 text-center">
            Use Arrow Keys to move the snake.
          </p>
        </div>
      )}
    </div>
  );
}

export default App;
