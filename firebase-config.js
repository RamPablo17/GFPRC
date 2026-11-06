const firebaseConfig = {
    apiKey: "AIzaSyC6hnZzrrTyinQTPxNk1dPE4q6-i-FtMII",
    authDomain: "cbprc-3fcbf.firebaseapp.com",
    projectId: "cbprc-3fcbf",
    storageBucket: "cbprc-3fcbf.firebasestorage.app",
    messagingSenderId: "966137602099",
    appId: "1:966137602099:web:9960a7e825bac94e034346"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
