const modal = document.getElementById('modal');
const title = document.getElementById('modalTitle');
const subtitle = document.getElementById('modalSubtitle');
const submit = document.getElementById('formSubmit');
const nameField = document.getElementById('nameField');

function openModal(mode) {
  const signup = mode === 'signup';
  title.textContent = signup ? 'Create your account' : 'Welcome back';
  subtitle.textContent = signup
    ? 'Join WorlDigi and begin exploring.'
    : 'Sign in to your WorlDigi account.';
  nameField.style.display = signup ? 'block' : 'none';
  submit.textContent = signup ? 'Create account' : 'Sign in';
  modal.classList.remove('hidden');
}

document.getElementById('signupBtn').onclick = () => openModal('signup');
document.getElementById('heroSignup').onclick = () => openModal('signup');
document.getElementById('loginBtn').onclick = () => openModal('login');
document.getElementById('heroLogin').onclick = () => openModal('login');
document.getElementById('closeModal').onclick = () => modal.classList.add('hidden');

modal.addEventListener('click', e => {
  if (e.target === modal) modal.classList.add('hidden');
});

document.getElementById('demoForm').addEventListener('submit', e => {
  e.preventDefault();
  alert('WorlDigi prototype: the real account system will be connected in the next stage.');
});
