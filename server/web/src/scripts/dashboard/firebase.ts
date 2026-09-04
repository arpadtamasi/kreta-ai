/** A böngészőoldali Firebase-belépés egyetlen példánya. */
import { getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBFaJ8tV0bC4yfff6pTj09M1Oc17S9KuPc",
  authDomain: "uzenofuzet.firebaseapp.com",
  projectId: "uzenofuzet",
  storageBucket: "uzenofuzet.firebasestorage.app",
  messagingSenderId: "652545082668",
  appId: "1:652545082668:web:2ae336556523a75af4d889",
};

export const auth = getAuth(getApps()[0] ?? initializeApp(firebaseConfig));

export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
