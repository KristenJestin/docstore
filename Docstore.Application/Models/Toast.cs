using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Docstore.Application.Models
{
    public class Toast
    {
        [JsonConverter(typeof(StringEnumConverter))]
        public ToastType Type { get; set; }
        public string Message { get; set; }

        public Toast(ToastType type, string message)
        {
            Type = type;
            Message = message;
        }
    }

    public enum ToastType
    {
        Success,
        Error,
        Warning,
        Information,
    }
}
