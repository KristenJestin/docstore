import flatpickr from 'flatpickr'
import 'flatpickr/dist/flatpickr.css'
import 'flatpickr/dist/themes/airbnb.css'

const DatePickerRange = (options = {}) => ({
    init() {
        const { picker1, picker2 } = this.$refs
        const now = new Date()

        flatpickr([picker1, picker2], {
            minDate: '1930-01',
            enableTime: false,
            dateFormat: 'Y-m-d',
            disableMobile: 'true',
            static: false,
            onChange: (selectedDates, dateStr, instance) => {
                const date = selectedDates[0]

                if (instance._input === picker1) {
                    picker2._flatpickr.config.minDate = date
                } else {
                    picker1._flatpickr.config.maxDate = date >= now || !date ? now : date
                }
            },
            ...options,
        })

        picker1._flatpickr.config.maxDate = now
    },
})

export default DatePickerRange
