import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../services/firebase"; // حسب اسمك الحقيقي

useEffect(() => {
  const q = query(
    collection(db, "orders"),
    where("status", "==", "new"),
    orderBy("createdAt", "desc")
  );

  let first = true;
  let prevCount = 0;

  const unsub = onSnapshot(q, (snap) => {
    const count = snap.size;

    if (!first && count > prevCount) {
      // استخدم showToast عندك بدل alert
      alert("✅ طلب جديد وصل!");
    }

    first = false;
    prevCount = count;
  });

  return () => unsub();
}, []);

function useEffect(arg0: () => () => void, arg1: undefined[]) {
    throw new Error("Function not implemented.");
}
