// Configuración de Supabase
const SUPABASE_URL = 'https://aiymadawznadvavzspxj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fL7vTXJ4NLhC2CJs9nPVAg_fvzWbfCY'; // <-- Pega aquí tu clave que empieza con sb_publishable_...

// Inicializar el cliente de Supabase
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const modal = document.getElementById('modal');
const title = document.getElementById('modalTitle');
const subtitle = document.getElementById('modalSubtitle');
const submit = document.getElementById('formSubmit');
const nameField = document.getElementById('nameField');
const emailField = document.getElementById('emailField');
const passwordField = document.getElementById('passwordField');

let currentMode = 'signup';

function openModal(mode) {
  currentMode = mode;
  const signup = mode === 'signup';
  title.textContent = signup ? 'Create your account' : 'Welcome back';
  subtitle.textContent = signup
    ? 'Join WorlDigi and begin exploring.'
    : 'Sign in to your WorlDigi account.';
  if (nameField) nameField.style.display = signup ? 'block' : 'none';
  submit.textContent = signup ? 'Create account' : 'Sign in';
  modal.classList.remove('hidden');
}

// Asignar eventos a los botones
const signupBtn = document.getElementById('signupBtn');
const heroSignup = document.getElementById('heroSignup');
const loginBtn = document.getElementById('loginBtn');
const heroLogin = document.getElementById('heroLogin');
const closeModal = document.getElementById('closeModal');

if (signupBtn) signupBtn.onclick = () => openModal('signup');
if (heroSignup) heroSignup.onclick = () => openModal('signup');
if (loginBtn) loginBtn.onclick = () => openModal('login');
if (heroLogin) heroLogin.onclick = () => openModal('login');
if (closeModal) closeModal.onclick = () => modal.classList.add('hidden');

modal.addEventListener('click', e => {
  if (e.target === modal) modal.classList.add('hidden');
});

document.getElementById('demoForm').addEventListener('submit', async e => {
  e.preventDefault();
  
  const email = emailField.value;
  const password = passwordField.value;
  const name = nameField ? nameField.value : '';

  submit.disabled = true;
  submit.textContent = 'Processing...';

  if (currentMode === 'signup') {
    const { data, error } = await supabaseClient.auth.signUp({
      email: email,
      password: password,
      options: { data: { full_name: name } }
    });

    if (error) {
      alert('Error signing up: ' + error.message);
    } else {
      alert('Account created successfully! Check your email for confirmation.');
      modal.classList.add('hidden');
    }
  } else {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (error) {
      alert('Error signing in: ' + error.message);
    } else {
      alert('Welcome back to WorlDigi!');
      modal.classList.add('hidden');
    }
  }

  submit.disabled = false;
  submit.textContent = currentMode === 'signup' ? 'Create account' : 'Sign in';
});
