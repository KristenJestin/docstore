const defaultTheme = require('tailwindcss/defaultTheme')
const { white, slate, red, green, yellow, sky } = require('tailwindcss/colors')

module.exports = {
    content: ['./Views/**/*.cshtml', './src/**/*.{js,ts,jsx,tsx}'],
    darkMode: 'class', // or 'media' or 'class'
    theme: {
        extend: {
            fontFamily: {
                sans: ['Poppins', ...defaultTheme.fontFamily.sans],
                header: ['Montserrat', ...defaultTheme.fontFamily.sans],
            },
            maxWidth: {
                '9/12': '75%',
            },
        },
        colors: {
            transparent: 'transparent',
            current: 'currentColor',
            white,
            gray: slate,
            black: '#0B101E',
            red,
            green,
            info: sky,
            primary: yellow,
        },
    },
    plugins: [require('@tailwindcss/forms')],
}
