using Microsoft.AspNetCore.Razor.TagHelpers;

namespace Docstore.App.Common.Extensions
{
    public static class TagHelperExtensions
    {
        /// <summary>
        /// Adds or updates the specified css class to list of classes of this TagHelperOutput.
        /// </summary>
        /// <param name="output"></param>
        /// <param name="newClass"></param>
        public static void AddCssClass(this TagHelperOutput output, string newClass)
        {
            var existingClass = output.Attributes.FirstOrDefault(f => f.Name == "class");
            var cssClass = string.Empty;
            if (existingClass != null)
            {
                cssClass = existingClass.Value.ToString();
                output.Attributes.Remove(existingClass);
            }

            cssClass = $"{cssClass} {newClass}";
            var ta = new TagHelperAttribute("class", cssClass);
            output.Attributes.Add(ta);
        }
    }
}
