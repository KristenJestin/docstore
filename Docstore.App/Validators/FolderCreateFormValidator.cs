using Docstore.App.Models.Forms;
using FluentValidation;

namespace Docstore.App.Validators
{
    public class FolderCreateFormValidator : AbstractValidator<FolderForm>
    {
        public FolderCreateFormValidator()
        {
            RuleFor(x => x.Name)
                .NotEmpty()
                .MaximumLength(255);

            RuleFor(x => x.Description)
                .NotEmpty()
                .MaximumLength(255);
        }
    }
}
