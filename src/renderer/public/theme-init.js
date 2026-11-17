try {
  if (localStorage.getItem('ccshell-theme') !== 'dark') document.documentElement.dataset.theme = 'light'
} catch {
  document.documentElement.dataset.theme = 'light'
}
