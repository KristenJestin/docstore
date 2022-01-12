import Alpine from 'alpinejs'

// register components
Object.entries(import.meta.globEager('./components/*.{js,ts}')).map(([file, value]) => {
    const name = file.replace(/\.\/components\/(.*[/])?([^/].+[^/])\.(js|ts)/gim, '$2')

    Alpine.data(name, value.default)
    return true
})

// start
window.Alpine = Alpine
Alpine.start()
