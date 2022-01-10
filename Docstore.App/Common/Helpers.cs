using Microsoft.AspNetCore.Mvc;

namespace Docstore.App.Common
{
    public static class Helpers
    {
        public static string ControllerName<T>() where T : Controller
            => typeof(T).Name.Replace("Controller", "");

        public static string GetUniqueFileName()
            => Guid.NewGuid().ToString();
    }
}
