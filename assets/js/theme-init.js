  // prevent flash of light theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark' || (savedTheme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark-mode');
  }
