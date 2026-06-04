/* ═══ FIREBASE CONFIGURATION ═══ */
const firebaseConfig = {
  apiKey: "AIzaSyDDela784e9uxCWEUHX3WtNoa3ykW4-6yU",
  authDomain: "monitoring-biopori-esp32.firebaseapp.com",
  databaseURL: "https://monitoring-biopori-esp32-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "monitoring-biopori-esp32",
  storageBucket: "monitoring-biopori-esp32.appspot.com",
  messagingSenderId: "442693556341",
  appId: "1:442693556341:web:b8b187fcff3a0499a0c03c",
  measurementId: "G-6NRY82N770"
};

// Initialize Firebase (Compat Version)
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

/* ═══ STATE ═══ */
let curUser = null, latPH = null, latGas = null;
let phArr = [], gasArr = [], lblArr = [];
let histRef = null, histItems = [];
let bioporiRef = null;
let pendingBiopori = null; 
let isCompostMature = false; // Penanda agar notifikasi tidak spam

/* ═══ UTILS ═══ */
function showErr(id,msg){const e=document.getElementById(id);e.textContent=msg;e.style.display='block'}
function hideErr(id){document.getElementById(id).style.display='none'}

/* ═══ AUTH ACTIONS ═══ */
function doLogin(){
  hideErr('liErr');
  const email=document.getElementById('liEmail').value.trim();
  const pass=document.getElementById('liPass').value;
  if(!email||!pass)return showErr('liErr','Email dan password wajib diisi.');
  auth.signInWithEmailAndPassword(email,pass).catch(e=>showErr('liErr',fe(e.code)));
}

function doLogout(){
  if(histRef)histRef.off();
  if(bioporiRef)bioporiRef.off();
  auth.signOut();
}

function fe(code){
  return({
    'auth/user-not-found':'Akun admin tidak ditemukan.',
    'auth/wrong-password':'Password salah.',
    'auth/invalid-credential':'Email atau password salah.',
    'auth/invalid-email':'Format email tidak valid.',
    'auth/too-many-requests':'Terlalu banyak percobaan. Coba lagi nanti.',
  }[code])||'Terjadi kesalahan. Coba lagi.';
}

/* ═══ AUTH STATE ═══ */
auth.onAuthStateChanged(user=>{
  if(user){curUser=user;showDash(user)}
  else{curUser=null;showAuth()}
});

function showAuth(){
  document.getElementById('authPage').classList.add('active');
  document.getElementById('dashPage').classList.remove('active');
}

function showDash(user){
  document.getElementById('authPage').classList.remove('active');
  document.getElementById('dashPage').classList.add('active');
  const name=user.displayName||user.email.split('@')[0];
  document.getElementById('uEmail').textContent=name;
  document.getElementById('uAvatar').textContent=name.charAt(0).toUpperCase();
  initCharts();
  startSensor();
  startBioporiListener(); 
  startHistory(user.uid);
}

/* ═══ CHARTS ═══ */
let phCh, gasCh;
function initCharts(){
  Chart.defaults.color='#94a3b8';
  Chart.defaults.font.family="'IBM Plex Mono',monospace";
  Chart.defaults.font.size=10;
  const opts=(bc,minY,maxY)=>({
    responsive:true,maintainAspectRatio:false,animation:{duration:500},
    plugins:{legend:{display:false},tooltip:{
      backgroundColor:'#0f2044',borderColor:bc,borderWidth:1,padding:10,
      titleColor:'rgba(255,255,255,.5)',bodyColor:'#fff',
      titleFont:{family:"'IBM Plex Mono'",size:10},bodyFont:{family:"'IBM Plex Mono'",size:13}
    }},
    scales:{
      x:{grid:{color:'#f1f5f9'},ticks:{maxTicksLimit:5,maxRotation:0,color:'#94a3b8'}},
      y:{min:minY,max:maxY,grid:{color:'#f1f5f9'},ticks:{maxTicksLimit:5,color:'#94a3b8'}}
    }
  });
  function grad(ctx,c1,c2){const g=ctx.createLinearGradient(0,0,0,170);g.addColorStop(0,c1);g.addColorStop(1,c2);return g}
  const pc=document.getElementById('phChart').getContext('2d');
  const gc=document.getElementById('gasChart').getContext('2d');
  if(phCh)phCh.destroy();if(gasCh)gasCh.destroy();
  phCh=new Chart(pc,{type:'line',data:{labels:lblArr,datasets:[{label:'PH',data:phArr,borderColor:'#2563eb',backgroundColor:grad(pc,'rgba(37,99,235,.18)','rgba(37,99,235,0)'),borderWidth:2,tension:.4,pointRadius:3,pointBackgroundColor:'#2563eb',fill:true}]},options:opts('#2563eb',0,14)});
  gasCh=new Chart(gc,{type:'line',data:{labels:lblArr,datasets:[{label:'Gas',data:gasArr,borderColor:'#d97706',backgroundColor:grad(gc,'rgba(217,119,6,.18)','rgba(217,119,6,0)'),borderWidth:2,tension:.4,pointRadius:3,pointBackgroundColor:'#d97706',fill:true}]},options:opts('#d97706',null,null)});
}

/* ═══ SENSOR LISTENER ═══ */
function startSensor(){
  db.ref('monitoring').on('value',snap=>{
    const d=snap.val();if(!d)return;
    
    // PERBAIKAN: Membaca gas_metana_ppm dari Firebase sesuai dengan kode ESP32 yang baru
    const ph = d.ph_tanah, gas = d.gas_metana_ppm;
    
    latPH=ph;latGas=gas;
    
    document.getElementById('phValue').textContent=typeof ph==='number'?ph.toFixed(1):ph;
    document.getElementById('gasValue').textContent=typeof gas==='number'?Math.round(gas):gas;
    
    const pct=Math.min(Math.max(ph/14,0),1)*100;
    document.getElementById('phNeedle').style.left=pct+'%';
    
    const ps=phStat(ph);
    document.getElementById('phStatus').innerHTML=`<span style="color:${ps.c}">●</span><span style="color:${ps.c};font-size:12px">${ps.t}</span>`;
    
    const gs=gasStat(gas);
    document.getElementById('gasStatus').innerHTML=`<span style="color:${gs.c}">●</span><span style="color:${gs.c};font-size:12px">${gs.t}</span>`;
    
    const t=new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    lblArr.push(t);phArr.push(ph);gasArr.push(gas);
    if(lblArr.length>20){lblArr.shift();phArr.shift();gasArr.shift()}
    if(phCh)phCh.update();if(gasCh)gasCh.update();
    
    document.getElementById('lastUpdate').textContent='Update: '+new Date().toLocaleString('id-ID');

    // Logika Notifikasi Kompos Matang
    if (ph >= 6.5 && ph <= 7.5 && gas <= 200) {
      if (!isCompostMature) {
        showToast("🎉 Hore! Kompos sudah matang siap panen!");
        isCompostMature = true; 
      }
    } else {
      isCompostMature = false; 
    }
  });
}

function phStat(v){
  if(v<6.5)return{t:'Asam',c:'#f97316'};
  if(v<=7.5)return{t:'Optimal ✓',c:'#059669'};
  return{t:'Basa',c:'#dc2626'};
}
function gasStat(v){
  if(v<=200)return{t:'Optimal ✓',c:'#059669'};
  if(v<=900)return{t:'Sedang',c:'#d97706'};
  return{t:'Tinggi ⚠',c:'#dc2626'};
}

/* ═══ BIOPORI LIST LISTENER ═══ */
function startBioporiListener() {
  if (!curUser) return;
  if (bioporiRef) bioporiRef.off();

  bioporiRef = db.ref(`biopori_list/${curUser.uid}`);
  bioporiRef.on('value', snap => {
    const selectBiopori = document.querySelector('.dc-select');
    const currentSelection = selectBiopori.value;

    selectBiopori.innerHTML = '<option value="" disabled selected>Pilih Biopori...</option>';

    const data = snap.val();
    if (data) {
      Object.keys(data).forEach(bName => {
        const opt = document.createElement('option');
        opt.value = bName;
        opt.textContent = bName;
        selectBiopori.appendChild(opt);
      });
    }

    if (pendingBiopori && data && data[pendingBiopori]) {
      selectBiopori.value = pendingBiopori;
      pendingBiopori = null; 
      loadHistoryForBiopori(); 
    } else if (currentSelection && data && data[currentSelection]) {
      selectBiopori.value = currentSelection;
    }
  });
}

/* ═══ SAVE SNAPSHOT ═══ */
function saveSnapshot(){
  if(!curUser)return;
  
  const selectBiopori = document.querySelector('.dc-select');
  const bName = selectBiopori.value;
  
  if(!bName) return showToast('⚠️ Pilih biopori terlebih dahulu di menu atas!');
  if(latPH===null||latGas===null)return showToast('⚠️ Belum ada data sensor untuk disimpan.');
  
  const now=new Date();
  // PERBAIKAN: Simpan data gas dengan key gas_metana_ppm
  db.ref(`history/${curUser.uid}/${bName}/${now.getTime()}`).set({
    ph_tanah:latPH, gas_metana_ppm:latGas,
    saved_at:now.toLocaleString('id-ID',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})
  }).then(()=>showToast(`✅ Snapshot ${bName} berhasil disimpan!`))
    .catch(()=>showToast('❌ Gagal menyimpan. Cek koneksi.'));
}

/* ═══ HISTORY LISTENER ═══ */
function loadHistoryForBiopori() {
  if(!curUser) return;
  if(histRef) histRef.off();

  const selectBiopori = document.querySelector('.dc-select');
  const bName = selectBiopori.value;

  if(!bName) {
    histItems = [];
    renderHistory();
    return;
  }

  histRef = db.ref(`history/${curUser.uid}/${bName}`);
  histRef.on('value', snap => {
    const raw = snap.val();
    histItems = [];
    if(raw) Object.entries(raw).forEach(([k,v]) => histItems.push({key:k, ...v}));
    histItems.sort((a,b) => b.key - a.key);
    renderHistory();
  });
}

function startHistory(uid){
  loadHistoryForBiopori();
}

function deleteItem(key){
  if(!curUser)return;
  
  const bName = document.querySelector('.dc-select').value;
  if(!bName) return;

  db.ref(`history/${curUser.uid}/${bName}/${key}`).remove()
    .then(()=>showToast('🗑️ Data berhasil dihapus.'))
    .catch(()=>showToast('❌ Gagal menghapus.'));
}

function renderHistory(){
  const list=document.getElementById('histList');
  document.getElementById('histCount').textContent=histItems.length+' catatan';
  if(histItems.length===0){
    list.innerHTML=`<div class="hist-empty"><div class="hist-empty-icon">📋</div>Belum ada data tersimpan.<br>Tekan <strong>Simpan Snapshot</strong> untuk mulai mencatat.</div>`;
    return;
  }
  
  // PERBAIKAN: Membaca gas_metana_ppm atau fallback ke gas_metana (untuk data riwayat yang lama)
  list.innerHTML=histItems.map((item,i)=> {
    const gasVal = item.gas_metana_ppm !== undefined ? item.gas_metana_ppm : (item.gas_metana !== undefined ? item.gas_metana : 0);
    return `
    <div class="hist-item" style="animation-delay:${i*.04}s">
      <div class="hist-num">#${histItems.length-i}</div>
      <div class="hist-ico">💾</div>
      <div class="hist-info">
        <div class="hist-time">📅 ${item.saved_at}</div>
        <div class="hist-vals">
          <div class="hv"><span class="hvl">PH:</span><span class="hv-ph">${typeof item.ph_tanah==='number'?item.ph_tanah.toFixed(1):item.ph_tanah}</span></div>
          <div class="hv"><span class="hvl">Gas:</span><span class="hv-gas">${typeof gasVal === 'number' ? Math.round(gasVal) : gasVal} ppm</span></div>
        </div>
      </div>
      <button class="hist-del" onclick="deleteItem('${item.key}')" title="Hapus">🗑</button>
    </div>
  `}).join('');
}

/* ═══ TOAST ═══ */
let toastT;
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  clearTimeout(toastT);
  toastT=setTimeout(()=>t.classList.remove('show'),3000);
}

/* ═══ DOM EVENT LISTENERS ═══ */
document.addEventListener('DOMContentLoaded', () => {
  const btnTambah = document.querySelector('.device-controls .btn-primary');
  const btnHapus = document.querySelector('.device-controls .btn-danger-out');
  const inputBiopori = document.querySelector('.dc-input');
  const selectBiopori = document.querySelector('.dc-select');

  if(selectBiopori) {
    selectBiopori.addEventListener('change', () => {
      loadHistoryForBiopori();
      showToast(`🔄 Menampilkan riwayat ${selectBiopori.value}`);
    });
  }

  if(btnTambah) {
    btnTambah.addEventListener('click', () => {
      const namaBiopori = inputBiopori.value.trim().replace(/[.#$\[\]]/g, '');
      if (!namaBiopori) return showToast('⚠️ Nama biopori tidak boleh kosong atau mengandung simbol khusus!');

      pendingBiopori = namaBiopori;

      db.ref(`biopori_list/${curUser.uid}/${namaBiopori}`).set(true)
        .then(() => {
          inputBiopori.value = ''; 
          showToast(`✅ ${namaBiopori} berhasil disimpan ke database!`);
        })
        .catch(() => {
          pendingBiopori = null; 
          showToast('❌ Gagal menyimpan biopori.');
        });
    });
  }

  if(btnHapus) {
    btnHapus.addEventListener('click', () => {
      const selectedIndex = selectBiopori.selectedIndex;
      if (selectedIndex <= 0) return showToast('⚠️ Pilih biopori di dropdown yang ingin dihapus!');
      
      const namaBiopori = selectBiopori.value;

      db.ref(`biopori_list/${curUser.uid}/${namaBiopori}`).remove()
        .then(() => {
          selectBiopori.selectedIndex = 0; 
          loadHistoryForBiopori(); 
          showToast(`🗑️ ${namaBiopori} berhasil dihapus permanen.`);
        })
        .catch(() => showToast('❌ Gagal menghapus biopori.'));
    });
  }
});