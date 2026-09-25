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
const togglePasswordBtn = document.getElementById('togglePassword');
const forgotPasswordLink = document.getElementById('forgotPasswordLink');

let currentMode = 'signup';

// Función para mostrar / ocultar contraseña
if (togglePasswordBtn && passwordField) {
  togglePasswordBtn.addEventListener('click', () => {
    const isPassword = passwordField.type === 'password';
    passwordField.type = isPassword ? 'text' : 'password';
    togglePasswordBtn.textContent = isPassword ? '🙈 Ocultar' : '👁️ Ver';
  });
}

function openModal(mode) {
  currentMode = mode;
  const signup = mode === 'signup';
  const recover = mode === 'recover';

  if (recover) {
    title.textContent = 'Reset your password';
    subtitle.textContent = 'Te enviaremos un enlace a tu correo para crear una contraseña nueva.';
  } else {
    title.textContent = signup ? 'Create your account' : 'Welcome back';
    subtitle.textContent = signup
      ? 'Join WorlDigi and begin exploring.'
      : 'Sign in to your WorlDigi account.';
  }

  if (nameField) {
    nameField.style.display = signup ? 'block' : 'none';
    nameField.required = signup; // Solo es obligatorio al registrarse
  }

  // En modo "recover" solo pedimos el correo; ocultamos la contraseña.
  if (passwordField) {
    const passwordWrap = passwordField.closest('.relative') || passwordField;
    passwordWrap.style.display = recover ? 'none' : '';
    passwordField.required = !recover;
  }

  // El enlace de "olvidé mi contraseña" solo tiene sentido en el login.
  if (forgotPasswordLink) {
    forgotPasswordLink.style.display = mode === 'login' ? 'block' : 'none';
  }

  submit.textContent = recover ? 'Enviar enlace' : (signup ? 'Create account' : 'Sign in');
  modal.classList.remove('hidden');
}

// Asignar eventos a los botones de la interfaz
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

if (forgotPasswordLink) {
  forgotPasswordLink.onclick = (e) => {
    e.preventDefault();
    openModal('recover');
  };
}

modal.addEventListener('click', e => {
  if (e.target === modal) modal.classList.add('hidden');
});

// Procesar el envío del formulario
document.getElementById('demoForm').addEventListener('submit', async e => {
  e.preventDefault();
  
const email = emailField.value;
  const password = passwordField.value;
  const name = nameField ? nameField.value : '';

  submit.disabled = true;
  submit.textContent = 'Processing...';

  try {
    if (currentMode === 'recover') {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password.html'
      });

      if (error) {
        alert('No se pudo enviar el enlace: ' + error.message);
      } else {
        alert('Si ese correo tiene una cuenta, te enviamos un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada.');
        modal.classList.add('hidden');
      }
    } else if (currentMode === 'signup') {
      const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: { data: { full_name: name } }
      });

      if (error) {
        alert('Error signing up: ' + error.message);
      } else {
        alert('¡Registro exitoso! Revisa tu correo y haz clic en el enlace de confirmación antes de entrar.');
        modal.classList.add('hidden');
      }
    } else {
      // Iniciar Sesión
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (error) {
        alert('Error al entrar: ' + error.message);
      } else {
        // Redireccionar al Muro Social automáticamente
        window.location.href = 'dashboard.html';
      }
    }
  } finally {
    // Estas dos líneas aseguran que el botón siempre vuelva a la normalidad
    submit.disabled = false;
    submit.textContent = currentMode === 'recover'
      ? 'Enviar enlace'
      : (currentMode === 'signup' ? 'Create account' : 'Sign in');
  }
});

