import flatpickr from 'flatpickr'
import 'flatpickr/dist/flatpickr.css'
import 'flatpickr/dist/themes/airbnb.css'

const DatePicker = (options = {}) => ({
    init() {
        const fp = flatpickr(this.$refs.picker, {
            minDate: '1930-01',
            enableTime: false,
            dateFormat: 'Y-m-d',
            disableMobile: 'true',
            static: false,
            onChange: (selectedDates, dateStr, instance) => {
                //...
            },
            ...options,
        })
    },
})

export default DatePicker
