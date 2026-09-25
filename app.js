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
    togglePasswordBtn.innerHTML = isPassword
      ? '<svg class="password-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.9 4.3A10.8 10.8 0 0 1 12 4c6.5 0 10 8 10 8a18.3 18.3 0 0 1-3.1 4.3"></path><path d="M6.6 6.6C3.7 8.5 2 12 2 12s3.5 8 10 8a10.8 10.8 0 0 0 3.2-.5"></path></svg><span>Ocultar</span>'
      : '<svg class="password-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg><span>Ver</span>';
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
      : 'Sign in to your ByGether account.';
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

