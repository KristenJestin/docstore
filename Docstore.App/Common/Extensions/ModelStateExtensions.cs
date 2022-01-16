using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Docstore.App.Common.Extensions
{
    public static class ModelStateExtensions
    {
        public static bool HasError(this ModelStateDictionary modelState, string propertyName)
            => modelState.Keys.Where(k => k.Equals(propertyName, StringComparison.OrdinalIgnoreCase)).Select(k => modelState[k]!.Errors).FirstOrDefault()?.Any() ?? false;
    }
}
